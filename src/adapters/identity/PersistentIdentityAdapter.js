import { IIdentityPort } from '../../core/ports/IIdentityPort.js';

/**
 * Placeholder for persistent identity across sessions.
 * Requires careful private key storage decisions before implementation.
 * Not implemented in MVP — use EphemeralIdentityAdapter instead.
 */
export class PersistentIdentityAdapter extends IIdentityPort {}
