# Security Policy

## Supported Scope

This project is an experimental but tested MVP for browser-based encrypted peer-to-peer messaging.

Security-sensitive areas include:

- WebRTC session setup
- WebCrypto key agreement and message encryption
- invite and answer code parsing
- message replay protection
- fingerprint verification UX

## Reporting

Do not open a public issue for a suspected vulnerability until impact is understood.

Report security concerns privately first, using one of these channels:

- GitHub private vulnerability reporting: the **Report a vulnerability** button on the repository's [Security tab](https://github.com/NLarchive/web-p2p-message/security)
- email `contact@nlarchive.com` with the subject `[security] web-p2p-message`

Expect an acknowledgement within 5 business days. Include:

- affected version or commit
- reproduction steps
- expected impact
- proof-of-concept details if available

## Current Security Boundaries

- encryption is end-to-end between peers after handshake completion (Double Ratchet over AES-GCM)
- the handshake is a hybrid post-quantum key agreement (XWing: ML-KEM-768 + X25519); it has not been independently audited
- signaling is manual (copy/paste codes); invites are signed with a per-session ECDSA P-256 key, but the channel used to share the codes is not authenticated, so users must compare fingerprints to rule out a man-in-the-middle
- the Content Security Policy is delivered as a `<meta>` tag because GitHub Pages cannot send response headers; `frame-ancestors` is therefore unavailable and the app refuses to run inside a frame instead
- WebRTC exposes the peer's IP address to the other peer; use a system VPN when that matters
- session deletion zeroizes Uint8Array key buffers best-effort; managed-runtime GC timing is not deterministic
- browser compatibility and production hardening are still limited compared with a mature messaging product
