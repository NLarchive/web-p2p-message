import { IStoragePort } from '../../core/ports/IStoragePort.js';

/**
 * Placeholder for IndexedDB-based persistent storage.
 * Suitable for larger data or structured queries.
 * Not implemented in MVP — use MemoryStorageAdapter instead.
 */
export class IndexedDbStorageAdapter extends IStoragePort {}
