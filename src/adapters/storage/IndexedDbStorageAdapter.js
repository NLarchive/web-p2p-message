import { IStoragePort } from '../../core/ports/IStoragePort.js';

export class IndexedDbStorageAdapter extends IStoragePort {
  constructor(dbName = 'p2p-message') {
    super();
    this._dbName = dbName;
    this._storeName = 'kv';
    this._dbPromise = this._open();
  }

  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this._storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async save(key, value) {
    const db = await this._dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      tx.objectStore(this._storeName).put(
        JSON.parse(JSON.stringify(value)),
        key,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async load(key) {
    const db = await this._dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readonly');
      const req = tx.objectStore(this._storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async remove(key) {
    const db = await this._dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      tx.objectStore(this._storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear() {
    const db = await this._dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      tx.objectStore(this._storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
