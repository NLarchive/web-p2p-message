# Signaling Options

## Goal

The system needs a way for peers to exchange WebRTC offer and answer data before the direct encrypted channel is established.

The project goal is to minimize external infrastructure, so the MVP choice favors low dependency and low operational cost over automatic discovery.

## Option Summary

| Option | External dependency | Cross-device | Security exposure | UX complexity | Score |
| --- | --- | --- | --- | --- | --- |
| Manual code or link exchange | None | Yes | Low if codes are short-lived and verified | Medium | 9/10 for this project |
| BroadcastChannel | None | No | Low | Low | 8/10 for local-only use |
| WebTorrent trackers | Public trackers | Yes | Medium | Low | 7/10 |
| Nostr relays | Public relays | Yes | Medium | Medium | 7/10 |
| Firebase or Supabase realtime | Third-party service | Yes | Medium | Low | 6/10 |
| MQTT public broker | Public broker | Yes | Medium to High | Low | 5/10 |
| IPFS pubsub | Public network | Yes | Medium | High | 5/10 |
| Shared paste or storage polling | Third-party service | Yes | High | High | 2/10 |

## Selected MVP Option

### Manual code or link exchange

Why it is the best fit now:

- no hosted service is required
- no external library is required for signaling
- it matches the requirement to reduce external code as much as possible
- it is easy to reason about and secure for an initial implementation
- it works as a clean base adapter before optional network signaling is added later

Tradeoffs:

- requires a two-step handshake
- connection setup is less convenient than auto-discovery
- large SDP payloads need compact encoding and a clean UI

## Recommended Fallback and Future Options

### BroadcastChannel

Use for same-browser, same-origin tabs during local development or to improve local collaboration behavior.

### WebTorrent or Nostr adapter

These are the best follow-up options if the project later wants easier cross-device discovery without owning a backend.

Recommendation order for future work:

1. Manual code or link exchange for MVP
2. BroadcastChannel for local UX improvements
3. WebTorrent adapter for optional public signaling
4. Nostr adapter as an alternative public signaling backend

## Invite Flow

The selected handshake flow is:

1. Host creates chat and generates an offer payload.
2. Host shares a code or link containing the encoded offer and host public key.
3. Guest opens the link or pastes the code, generates an answer payload, and returns a response code.
4. Host pastes the response code and completes the WebRTC connection.
5. After connection, all chat messages flow peer to peer.

## Security Requirements For Any Signaling Strategy

Any signaling adapter used in this project should preserve these rules:

- signaling must never be treated as trusted
- chat messages must never depend on signaling confidentiality
- peer fingerprints must be shown for manual verification
- invite payloads must expire quickly
- room identifiers must have high entropy