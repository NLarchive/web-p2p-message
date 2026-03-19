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

- do not persist long-term private session keys
- keep active session secrets in memory when possible
- if history persistence is added later, make it opt-in and document the local device risk clearly

## Post-Quantum Preparation

The MVP is not post-quantum secure. It should not claim that it is.

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

The correct way to hide your real IP in a WebRTC session is to route all traffic through Tor or a VPN **before** it reaches the browser:

- When Tor Browser is used with WebRTC enabled (in a safe configuration), or when the OS routes all traffic through Tor, the peer and network only see the Tor exit IP.
- A VPN achieves the same at the ISP level; the peer sees the VPN server IP.
- The app does not need to change at all — the IP hiding is transparent at the network layer.

This app detects whether the current connection is routed through Tor (via the Tor Project's official check endpoint) and shows a status indicator on the session list screen. The check is non-persistent: only the boolean result is retained in memory; no IP address is stored or logged anywhere.

**Guidance for users who need IP anonymity:**

1. Use Tor Browser (with WebRTC enabled per Tor Project guidance), or
2. Enable a trusted VPN before opening the app, then verify the "Using Tor / VPN" indicator.

### Residual risks

- Even through Tor, WebRTC timing and traffic patterns may be observable by a sufficiently resourced adversary.
- A VPN provider can observe your real IP; choose accordingly.
- Both peers expose their exit IP to each other unless both route through Tor/VPN simultaneously.
- This app does not and cannot force either party to use Tor or a VPN.