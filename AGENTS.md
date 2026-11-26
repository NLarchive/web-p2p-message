# AGENTS.md — guidance for coding agents

Browser-to-browser end-to-end encrypted chat (WebRTC DataChannels + WebCrypto + Double Ratchet,
hybrid post-quantum handshake). Vanilla JavaScript ES modules, no bundler, deployed as a static
site to GitHub Pages: https://nlarchive.github.io/web-p2p-message/

## Architecture (hexagonal / ports and adapters)

| Ring | Folder | Rule |
| --- | --- | --- |
| 0 domain | `src/core/domain/` | Pure entities (Session, Message, PeerIdentity, Envelope). No browser APIs. |
| 1 ports | `src/core/ports/` | Interface contracts (crypto, identity, signaling, storage, transport). |
| 2 use cases / services | `src/core/usecases/`, `src/core/services/` | Orchestrate domain through ports only. |
| 2 adapters | `src/adapters/*` | Implement ports with browser APIs (WebCrypto, WebRTC, IndexedDB…). |
| 3 composition + UI | `src/config/composition-root.js`, `src/ui/`, `src/workers/` | Wire adapters; render the UI. |

Core code must never import from `src/adapters`, `src/ui` or `src/workers`.

## Commands

```bash
npm ci                 # also vendors @noble/* into /vendor via postinstall
npm test               # Vitest unit + integration (163 tests)
npm run test:ci        # unit tests + build + smoke test (what CI runs)
npm run test:e2e       # Playwright, Chromium, against dist/ (9 tests)
npx playwright test   # same 9 scenarios per browser in Chromium, Firefox, and WebKit
npm run test:security  # private interceptor suite (needs message-interceptor/ and `npm run preview`)
```

## Rules

- Keep the CSP strict: no inline scripts or styles. `scripts/build.mjs` re-hashes the importmap
  into the CSP; JSON-LD (`application/ld+json`) is a non-executed data block and is allowed.
- Security claims in README/SECURITY.md/docs must match the code and the tests.
- Track work in `node.tasks.json` (root) and its child graphs; update status and evidence when a
  task progresses.
- `message-interceptor/` is intentionally git-ignored (private attack tooling).
