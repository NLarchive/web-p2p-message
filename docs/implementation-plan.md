# Implementation Plan

## Outcome

Deliver a browser-based one-to-one encrypted P2P chat with manual invite flow, modular architecture, and documentation strong enough to support future signaling and crypto upgrades.

## MVP Scope

### In scope

- application shell and project structure
- hexagonal core and adapter contracts
- manual code or link signaling flow
- WebRTC data channel messaging
- WebCrypto-based encrypted message exchange
- fingerprint verification UI
- basic error states and session lifecycle handling
- documentation and delivery tracking

### Out of scope

- group messaging
- CRDT-based shared state sync
- full offline replication mesh
- production-grade public signaling integration
- production-grade post-quantum cryptography

## Build Sequence

1. Create source structure and composition root.
2. Define ports and domain models.
3. Implement manual signaling adapter.
4. Implement WebRTC transport adapter.
5. Implement WebCrypto encryption adapter.
6. Build create, join, finalize, and send-message use cases.
7. Build the browser UI for invite flow, verification, and chat.
8. Add browser compatibility checks and test coverage.
9. Harden security details and document limits.

## Definition Of Done For MVP

- two browsers can connect using the invite flow
- users can exchange encrypted messages after the handshake
- fingerprints are visible and comparable
- disconnect and invalid code errors are handled
- documentation reflects the real implementation
- task tracker is updated to match progress

## First Release Constraints

- prioritize clarity over feature count
- prefer native browser APIs over external dependencies
- keep modules small and replaceable
- avoid premature persistence features until security decisions are explicit