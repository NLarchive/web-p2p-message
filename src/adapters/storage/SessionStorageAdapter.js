import { IStoragePort } from '../../core/ports/IStoragePort.js';

export class SessionStorageAdapter extends IStoragePort {
  async save(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  async load(key) {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }

  async remove(key) {
    sessionStorage.removeItem(key);
  }

  async clear() {
    sessionStorage.clear();
  }
}
