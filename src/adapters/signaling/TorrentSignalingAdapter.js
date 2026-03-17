import { ISignalingPort } from '../../core/ports/ISignalingPort.js';

/**
 * Placeholder for WebTorrent tracker-based signaling.
 * Uses public BitTorrent WebSocket trackers for peer discovery.
 * Not implemented in MVP — use ManualCodeSignalingAdapter instead.
 */
export class TorrentSignalingAdapter extends ISignalingPort {}
