import { ISignalingPort } from '../../core/ports/ISignalingPort.js';

/**
 * Placeholder for Nostr relay-based signaling.
 * Uses decentralized Nostr relays for peer discovery.
 * Not implemented in MVP — use ManualCodeSignalingAdapter instead.
 */
export class NostrSignalingAdapter extends ISignalingPort {}
