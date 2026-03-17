import { IStoragePort } from '../../src/core/ports/IStoragePort.js';

export class MockStoragePort extends IStoragePort {
  constructor() {
    super();
    this._store = new Map();
  }

  async save(key, value) {
    this._store.set(key, JSON.parse(JSON.stringify(value)));
  }

  async load(key) {
    if (!this._store.has(key)) return null;
    return JSON.parse(JSON.stringify(this._store.get(key)));
  }

  async remove(key) {
    this._store.delete(key);
  }

  async clear() {
    this._store.clear();
  }
}
