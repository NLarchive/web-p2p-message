# P2P Message

Client-side, browser-to-browser encrypted messaging with minimal external infrastructure. The app uses WebRTC for peer transport, WebCrypto for end-to-end encryption, and a manual code exchange so peers can connect without a backend that stores chat data.

live on: https://nlarchive.github.io/web-p2p-message/

## Project Status

This repository now contains a working MVP implementation with automated tests, a static site build, and GitHub Pages deployment support.

## Open Source License

This project is licensed under the GNU Affero General Public License v3.0 or later.

- source code remains open
- modified and derivative versions must also remain open under the same license terms
- network use is covered, which matters for web-based software

See the LICENSE file for the full text.

## Product Goal

Build a secure P2P chat where:

- each browser acts as a node
- chat data flows directly between peers after connection
- invite access is controlled by a shareable code or link
- messages are encrypted end to end
- the initial version minimizes external libraries and hosted services
- the architecture stays modular so signaling, crypto, and storage strategies can be swapped later

## Selected Technical Direction

- Architecture: Hexagonal or Ports and Adapters
- Transport: WebRTC data channels
- MVP signaling: manual code or link exchange, no owned server required
- Local-only sync: BroadcastChannel for same-origin tabs when useful
- Encryption: WebCrypto with ephemeral session keys and AES-GCM for application-layer E2EE
- Post-quantum handshake: Hybrid XWing (ML-KEM-768 + X25519) fully implemented; crypto adapter remains replaceable
- Security verification: peer fingerprint comparison in the UI; CSP meta tag with importmap SHA-256 hash

## Why This Direction

This path keeps the first implementation small and understandable while preserving an upgrade path:

- no mandatory backend for message transport
- minimal third-party dependencies for the MVP
- clean separation between domain logic and browser-specific APIs
- clear room for future signaling adapters such as WebTorrent or Nostr
- clear room for future post-quantum crypto work without rewriting the app core

## Current Capabilities

- create a host session and generate an invite code
- join a session using that invite code
- generate and exchange a manual answer code
- derive a shared encryption key with hybrid post-quantum handshake (XWing) or WebCrypto ECDH
- exchange encrypted one-to-one messages over WebRTC DataChannels using AES-GCM
- compare peer fingerprints in the UI with verified/unverified status tracking
- fingerprint change detection with blocking warning on reconnect (auto-resets verification)
- network privacy guidance via local WebRTC probe; recommends a mainstream browser + system VPN for the default path, and flags Tor/Tails/Whonix as advanced setups
- optional TURN relay configuration for relay-only ICE when WebRTC is enabled in advanced privacy setups
- transport-level DoS hardening: 32 KB max incoming payload, 30 msg/s rate limit per DataChannel
- strict CSP: no unsafe-inline directives, connect-src restricted to self
- toast error/success notifications (replaces static error text)
- session list search filter (DOM-only, no re-render) when multiple sessions exist
- one-click clipboard copy with success feedback on all invite/answer codes
- retry connection and refresh status buttons on the session detail view
- run comprehensive automated test suite (unit, E2E, security interceptor)

## Planned Repository Structure

```text
src/
  core/
    domain/
    ports/
    usecases/
  adapters/
    crypto/
    identity/
    signaling/
    storage/
    transport/
  config/
  ui/
  shared/
docs/
.github/
scripts/
```

## Local Development

Requirements:

- Node.js 20 or newer recommended

Commands:

```bash
npm install
npm run test
npm run build
npm run preview
```

CI-style verification:

```bash
npm run test:ci
```

The preview server serves the built `dist/` directory so the same artifact can be used locally and on GitHub Pages.

## GitHub Pages

This repository includes a GitHub Actions workflow that builds the static app and deploys `dist/` to GitHub Pages on pushes to `master`.

Repository:

```text
https://github.com/NLarchive/web-p2p-message
```

Live site:

```text
https://nlarchive.github.io/web-p2p-message/
```

## Testing

Three-layer automated test suite:

**Unit & Integration (163 tests via Vitest):**
- domain rules and state transitions
- encoding and validation helpers
- crypto, signaling, storage, and identity adapters
- use case orchestration
- encrypted end-to-end flow

**End-to-End (4 scenarios via Playwright):**
- complete host and guest chat flow with WebRTC connection and encrypted messages
- expired invite rejection
- garbage invite rejection
- reconnect flow (host reconnects to existing session)

**Security Interceptor Suite (11 attack techniques):**
- payload analysis (forbidden key fields: `seed`, `d`, nested objects)
- crypto brute-force (key length analysis)
- MITM tampering (hybrid XWing key corruption)
- replay attack resistant (timestamp + counter validation)
- session hijack (IDB key non-extractability verification)
- invite expiry manipulation (Infinity, future timestamps rejected)
- downgrade attack (algorithm substitution rejection)
- envelope fuzzing (JSON parsing robustness)
- nonce replay (AES-GCM IV deduplication at DataChannel layer)
- invite signing (ECDSA P-256 per-field coverage: `t`, `i`, `s`; signature-stripping defense)
- ratchet properties (directional HKDF, bidirectional symmetry, per-step uniqueness, non-extractable message keys, initDhRatchet chain matching, DH healing step)

**Build Verification:**
- static artifact smoke test

## Documentation

- [Architecture](docs/architecture.md)
- [Signaling Options](docs/signaling-options.md)
- [Security Model](docs/security.md)
- [Implementation Plan](docs/implementation-plan.md)

## MVP Scope

Included in the first deliverable:

- create chat session
- join chat session with a code or link
- complete manual WebRTC offer and answer flow
- encrypted one-to-one messaging
- fingerprint verification UI
- minimal local session state handling

Deferred until after MVP:

- group chat
- offline mesh replication across many peers
- full CRDT sync engine
- public signaling adapter integrations (WebTorrent, Nostr, Matrix)

## Delivery Tracking

The project execution plan is maintained in [p2p-message-project-tasks.json](p2p-message-project-tasks.json).

## Known Limitations

- manual signaling requires copying codes between peers (trade-off for zero-server architecture)
- one-to-one chat only (no group support)
- browser interoperability testing is narrower than production standards
- Tor Browser is not the default supported privacy path; it requires advanced WebRTC/TURN configuration and can expose IPs if misconfigured
- post-quantum handshake (XWing hybrid) is not yet production-audited; should be peer-reviewed before high-security deployments

## Recent Security Fixes (Current)

- **Timestamp validation:** rejects Infinity, non-finite values, and future timestamps beyond 30s clock skew
- **Counter validation:** rejects non-finite counters, values ≤ last received, and jumps >10,000 (DoS hardening)
- **Forbidden key fields:** expanded checks for private key material (`seed` for XWing, `d` for ECDH) including nested objects
- **CSP hardening:** meta tag includes `sha256-...` hash for importmap script
- **Invite signing (ECDSA P-256):** host generates a signing key per session; invite canonical bytes are signed; guest rejects any tampered payload
- **Signature-stripping defense:** if the invite declares a signing key (`vk`) the `sig` field is now mandatory; a stripped signature is rejected as a downgrade attack
- **DH ratchet healing (Double Ratchet):** each session now performs the full Signal-protocol Double Ratchet — `initDhRatchet` derives a shared root key + directed chains from P-256 ECDH combined with the XWing shared secret; the guest performs an initial DH step (Signal "Alice sends first") so the first outgoing message carries a fresh ephemeral key; every time a peer receives a message with a ratchet public key different from the last one seen, `_performDhRatchetStep` runs: two advances of the root chain + fresh local keypair discard — recovering forward secrecy even if an attacker learns an in-session chain key; out-of-order delivery is handled via a MAX_SKIP=100 bounded skipped-message-key buffer; nonce dedup operates on the inner `c` field of the `{v:2,pk,n,c}` wire envelope
- **Combined fingerprint:** UI fingerprint now covers both KEM public key and signing public key (SHA-256 of both), making MITM substitution detectable
- **Per-message symmetric ratchet:** HKDF derives directional send/receive chain keys from shared session secret; HMAC-SHA-256 advances each step to a fresh AES-GCM message key per message
- **AES-GCM nonce deduplication:** per-session bounded set of seen IVs; replayed ciphertexts are silently dropped before decryption regardless of counter state
- **Transport DoS hardening:** 32 KB max incoming message size and 30 msg/s sliding-window rate limit per WebRTC DataChannel; oversized or excess messages silently dropped
- **Fingerprint verification state:** Session domain tracks `fingerprintVerified` and `_previousRemoteFingerprint`; UI shows verified/unverified badge; fingerprint change on reconnect auto-resets verification and shows a blocking warning
- **CSP tightened:** removed `unsafe-inline` from `style-src`, added `connect-src 'self'`
- **Local privacy probe:** replaced external `check.torproject.org` fetch with a local `RTCPeerConnection` probe — no network request, and the UI now frames VPN as the recommended default while keeping Tor/Tails/Whonix as an advanced path
- **TURN relay support:** added optional relay-only ICE configuration for advanced users who enable WebRTC and want TCP relay transport
- **Branch sync:** `main` and `master` now point to identical commits; older GitHub file views showed stale `master` until force-push

## Notes

The earlier exploratory research has been reorganized under [docs](docs).