import { webcrypto } from 'node:crypto';

// Polyfill WebCrypto for Node.js test environment (needed for Node < 20)
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}
