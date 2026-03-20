# Security Model

## Security Goal

Protect message confidentiality, protect access to chat sessions, reduce metadata exposure where possible, and keep a clean upgrade path for stronger cryptography later.

## MVP Security Baseline

### Transport

- WebRTC data channels for peer-to-peer transport
- DTLS protection provided by the browser transport stack

### Application encryption

- WebCrypto API only
- ephemeral session key agreement for each chat
- AES-GCM for authenticated encryption of each message
- fresh random IV for every encrypted payload

### Access model

- access requires the invite code or link exchange
- invites must be short-lived
- rooms must use high-entropy identifiers

### Identity verification

- show both peer fingerprints in the UI
- require manual comparison for higher assurance

## Threats And Controls

| Threat | Control |
| --- | --- |
| Invite interception | Invite only contains public material and transient signaling payloads |
| Man-in-the-middle during handshake | Display peer fingerprints for manual verification |
| Message interception | Encrypt all application messages with AES-GCM |
| Replay attempts | Include message counter and timestamp in encrypted payload |
| Reuse of stale invite | Expire sessions and reject old offer or answer payloads |
| Local device compromise | Keep secrets ephemeral where possible and avoid persistent plaintext history by default |

## Storage Guidance

For the first version, default to minimal retention:

- persist only public session metadata and message history by default
- keep active session secrets in memory when possible
- if secret persistence is ever enabled, make it opt-in and protect it with a user-supplied passphrase-based wrapping key
- document the local device risk clearly because any browser-profile access can expose persisted material

## Post-Quantum Preparation

The current implementation includes a hybrid post-quantum handshake, but it is not production-audited. It should not be marketed as quantum-safe.

The project should instead be post-quantum ready at the architecture level:

- keep crypto behind a dedicated port
- keep handshake logic separated from the UI and transport
- allow a future hybrid adapter without redesigning the core

## Future Post-Quantum Upgrade Path

When the project is ready for a stronger design, target a hybrid key establishment model inspired by modern secure messengers:

- classical component: X25519 or equivalent modern ECDH
- post-quantum component: ML-KEM based hybrid exchange when using a well-reviewed browser-compatible implementation
- key derivation: HKDF over both shared secrets
- session evolution: ratcheting or periodic rekeying for forward secrecy improvements

## Non-Negotiable Security Rules

- never trust signaling content
- never send plaintext chat messages over the transport
- never reuse IVs with AES-GCM
- never market the MVP as quantum-safe
- always separate current guarantees from future goals in documentation

## IP Privacy and Network Anonymity

### What WebRTC exposes

WebRTC is a real endpoint-to-endpoint UDP protocol. ICE candidates contain real IP:port pairs that both peers must see to route packets. This is by design — the network stack has no way to deliver packets to an encrypted or fabricated address.

The only "IP privacy" built into WebRTC itself is **mDNS masking** of *local* (LAN) IPs in ICE candidates; public/reflexive IPs are always real.

### Why "IP crypto at the app layer" does not work

You cannot encrypt or randomize the IP address inside a WebRTC application:

- The ICE agent and STUN stack inside the browser will use and expose real IPs regardless of what the JS layer does.
- If the IP in a candidate string is mangled, the remote ICE agent cannot route to it → connection always fails.
- No JS-accessible API can intercept or rewrite the IP header; that requires a VPN driver or kernel module.
- Attempting this would only give users a false sense of privacy, which is worse than doing nothing.

This idea is explicitly rejected as a design direction for this project.

### Recommended approach: Tor or VPN at the OS/network layer

The correct way to hide your real IP in a WebRTC session is to route all traffic through a VPN, or use an expert-managed Tor setup with WebRTC and a TCP relay, **before** the traffic reaches the browser:

- A VPN hides your real IP from peers; the peer sees the VPN server IP.
- Expert Tor/Tails/Whonix setups can do the same if WebRTC is explicitly enabled and all traffic is forced through a TCP TURN relay.
- The app does not need to change at all — the IP hiding is transparent at the network layer.

This app detects whether WebRTC is disabled by attempting a local ICE candidate gather with no STUN servers. If no candidates are found or `RTCPeerConnection` is unavailable, the app shows a privacy guidance message. No external network request is made — detection is fully local and IP-blind.

**Guidance for users who need IP privacy:**

1. Use a trusted VPN before opening the app, then verify the privacy indicator.
2. If you are an advanced Tor/Tails/Whonix user, follow Tor Project guidance, enable WebRTC explicitly, and configure a TCP TURN relay.

### Residual risks

- A VPN provider can observe your real IP; choose accordingly.
- Even in advanced Tor/Tails/Whonix setups, WebRTC timing and traffic patterns may be observable by a sufficiently resourced adversary.
- Both peers expose their exit IP to each other unless both route through the same anonymity layer simultaneously.
- This app does not and cannot force either party to use Tor or a VPN.

## DoS and Resource Exhaustion Hardening

The transport and session layers enforce several limits to prevent a rogue peer from consuming unbounded resources:

- **Max ciphertext size (32 KB):** The WebRTC transport adapter silently drops any incoming message larger than 32 KB before it reaches decryption. This prevents memory exhaustion from inflated payloads.
- **Rate limiting (30 msg/s):** A sliding-window counter rejects more than 30 incoming messages per second per data channel. Excess messages are silently dropped.
- **Counter jump limit (10,000):** `Session.validateReceivedCounter` rejects any message whose counter jumps more than 10,000 steps ahead, preventing counter-flooding DoS.
- **Nonce dedup buffer (500):** A rolling 500-item set of previously seen AES-GCM IVs rejects replayed ciphertexts before decryption.
- **Ratchet skip limit (MAX_SKIP=100):** Out-of-order message key buffering caps at 100 skipped positions; requests beyond this are rejected.
- **Skipped key buffer cap (200):** Oldest entries are evicted when the skipped-message-key map exceeds 200 entries.

## Content Security Policy

The CSP meta tag enforces:

- `default-src 'self'` — restrictive baseline
- `script-src 'self' 'sha256-...'` — no `unsafe-inline` for JS; only a SHA-256 hash for the importmap
- `style-src 'self'` — no `unsafe-inline` for styles (CSS injection mitigated)
- `connect-src 'self'` — no external fetch/XHR allowed
- `object-src 'none'` — blocks plugins
- `base-uri 'self'` — restricts base tag

No third-party JS (analytics, widgets, etc.) is loaded in the main app path.

## Fingerprint Verification

Sessions track a `fingerprintVerified` boolean (default: `false`). The user can manually mark a peer's fingerprint as verified after out-of-band comparison. If the remote peer's fingerprint changes on reconnect:

- The previous fingerprint is stored for comparison.
- Verification is automatically reset.
- A prominent warning is shown: "Peer keys changed — verify via another channel before continuing."

The chat header shows "Verified" (green) or "Unverified" status at all times.