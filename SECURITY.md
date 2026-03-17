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

Report security concerns privately to the project owner first. Include:

- affected version or commit
- reproduction steps
- expected impact
- proof-of-concept details if available

## Current Security Boundaries

- encryption is end-to-end between peers after handshake completion
- signaling is manual and not authenticated beyond fingerprint comparison
- persistent identity and post-quantum cryptography are not part of the MVP
- browser compatibility and production hardening are still limited compared with a mature messaging product
