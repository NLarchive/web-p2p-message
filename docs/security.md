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