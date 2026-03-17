# P2P Message

Client-side, browser-to-browser encrypted messaging with minimal external infrastructure. The app uses WebRTC for peer transport, WebCrypto for end-to-end encryption, and a manual code exchange so peers can connect without a backend that stores chat data.

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
- Encryption: WebCrypto with ephemeral session keys and AES-GCM
- Security verification: peer fingerprint comparison in the UI
- Post-quantum path: keep the crypto adapter replaceable so a hybrid PQ handshake can be added later

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
- derive a shared encryption key with WebCrypto ECDH
- exchange encrypted one-to-one messages over WebRTC DataChannels
- compare peer fingerprints in the UI
- run automated unit, adapter, use case, and integration tests

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

This repository includes a GitHub Actions workflow that builds the static app and deploys `dist/` to GitHub Pages on pushes to `main`.

Repository:

```text
https://github.com/NLarchive/web-p2p-message
```

Live site:

```text
https://nlarchive.github.io/web-p2p-message/
```

## Testing

The automated suite currently covers:

- domain rules and state transitions
- encoding and validation helpers
- crypto, signaling, storage, and identity adapters
- use case orchestration
- end-to-end host and guest flow with mocks
- static build smoke verification

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
- production-ready post-quantum cryptography
- public signaling adapter integrations

## Delivery Tracking

The project execution plan is maintained in [p2p-message-project-tasks.json](p2p-message-project-tasks.json).

## Known Limitations

- manual signaling requires copying codes between peers
- the current UI is optimized for one-to-one chat only
- browser interoperability testing is still narrower than a full public release matrix
- post-quantum cryptography is not implemented in the MVP

## Notes

The earlier exploratory research has been reorganized under [docs](docs).