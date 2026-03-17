import { IStoragePort } from '../../core/ports/IStoragePort.js';
import { encode, decode } from '../../shared/encoding/base64url.js';

export class IndexedDbStorageAdapter extends IStoragePort {
  constructor(dbName = 'p2p-message') {
    super();
    this._dbName = dbName;
    this._storeName = 'kv';
    this._metaStoreName = 'meta';
    this._dbPromise = this._open();
    this._keyPromise = null;
  }

  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(this._storeName)) {
          req.result.createObjectStore(this._storeName);
        }
        if (!req.result.objectStoreNames.contains(this._metaStoreName)) {
          req.result.createObjectStore(this._metaStoreName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async _getEncryptionKey() {
    if (!this._keyPromise) {
      this._keyPromise = (async () => {
        const db = await this._dbPromise;
        const existing = await new Promise((resolve, reject) => {
          const tx = db.transaction(this._metaStoreName, 'readonly');
          const req = tx.objectStore(this._metaStoreName).get('enc-key');
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error);
        });
        if (existing) return existing;

        const key = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        );

        await new Promise((resolve, reject) => {
          const tx = db.transaction(this._metaStoreName, 'readwrite');
          tx.objectStore(this._metaStoreName).put(key, 'enc-key');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });

        return key;
      })();
    }

    return this._keyPromise;
  }

  async _encryptValue(value) {
    const key = await this._getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext,
    );
    return {
      v: 1,
      iv: encode(iv),
      data: encode(new Uint8Array(ciphertext)),
    };
  }

  async _decryptValue(record) {
    if (!record || typeof record !== 'object' || record.v !== 1) {
      return record ?? null;
    }

    const key = await this._getEncryptionKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(record.iv) },
      key,
      decode(record.data),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  async save(key, value) {
    const db = await this._dbPromise;
    const encrypted = await this._encryptValue(value);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      tx.objectStore(this._storeName).put(encrypted, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async load(key) {
    const db = await this._dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readonly');
      const req = tx.objectStore(this._storeName).get(key);
      req.onsuccess = async () => {
        try {
          resolve(await this._decryptValue(req.result ?? null));
        } catch (error) {
          reject(error);
        }
      };
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
