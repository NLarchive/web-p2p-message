# web-p2p-message Workspace Notes

## Architecture
- Hexagonal / Ports & Adapters, vanilla JS ES Modules
- Domain: Session (state machine), Message, PeerIdentity, Envelope (msg/control protocol)
- Services: SessionManager (multi-session orchestrator, `src/core/services/`)
- Adapters: WebCrypto, WebRTC, IndexedDB, Manual signaling, Ephemeral identity
- Composition root: `createSessionService()` (legacy single-session), `createSessionManager()` (multi-session)

## Key Patterns
- Each session has its own WebRTC transport instance
- SessionManager uses event emitter pattern: on('update'), on('message'), on('control')
- Envelope protocol wraps chat messages and control signals: `{ t:'m', d:... }` and `{ t:'c', a:action, d:... }`
- IndexedDB stores sessions under `session:{id}`, messages under `messages:{id}`, index under `session_ids`
- Private keys stored as JWK for re-derivation of shared key on restore
- DISCONNECTED sessions can transition to CONNECTING for reconnection

## Testing
- `npm test` — vitest unit tests (104 tests), excludes e2e via vitest config
- `npm run test:e2e` — Playwright chromium tests (3 tests) against preview server
- Preview server: `node scripts/build.mjs && node scripts/preview.mjs` on port 4173
- Mock helpers in `tests/helpers/` — crypto.subtle.exportKey must be mocked for mock keys

## Repo
- GitHub: NLarchive/web-p2p-message
- Pages: https://nlarchive.github.io/web-p2p-message/
- License: AGPL-3.0
