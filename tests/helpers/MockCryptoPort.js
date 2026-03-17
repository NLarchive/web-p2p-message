import { ICryptoPort } from '../../src/core/ports/ICryptoPort.js';

let counter = 0;

export class MockCryptoPort extends ICryptoPort {
  async generateKeyPair() {
    const id = ++counter;
    return {
      publicKey: { _mock: true, id, type: 'public' },
      privateKey: { _mock: true, id, type: 'private' },
    };
  }

  async exportPublicKey(publicKey) {
    return {
      kty: 'EC',
      crv: 'P-256',
      x: `mock_x_${publicKey.id}`,
      y: `mock_y_${publicKey.id}`,
    };
  }

  async importPublicKey(jwk) {
    return { _mock: true, imported: true, jwk };
  }

  async deriveSharedKey(privateKey, remotePublicKey) {
    return { _mock: true, type: 'shared' };
  }

  async encrypt(plaintext, _sharedKey) {
    return `enc:${plaintext}`;
  }

  async decrypt(ciphertext, _sharedKey) {
    if (!ciphertext.startsWith('enc:')) throw new Error('Invalid ciphertext');
    return ciphertext.slice(4);
  }

  async fingerprint(publicKeyJwk) {
    return `fp:${publicKeyJwk.x || 'unknown'}`;
  }
}
