import { ICryptoPort } from '../../src/core/ports/ICryptoPort.js';

let counter = 0;

export class MockCryptoPort extends ICryptoPort {
  get handshakeMode() {
    return 'dh';
  }

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

  async exportPrivateKey(privateKey) {
    return { _mock: true, privateKeyId: privateKey.id };
  }

  async importPrivateKey(serialized) {
    return { _mock: true, id: serialized.privateKeyId, type: 'private' };
  }

  async deriveSharedKey(privateKey, remotePublicKey) {
    return { _mock: true, type: 'shared' };
  }

  async exportSharedKey() {
    return 'mock-shared-key';
  }

  async importSharedKey() {
    return { _mock: true, type: 'shared' };
  }

  async encrypt(plaintext, _sharedKey) {
    return `enc:${plaintext}`;
  }

  async decrypt(ciphertext, _sharedKey) {
    if (!ciphertext.startsWith('enc:')) throw new Error('Invalid ciphertext');
    return ciphertext.slice(4);
  }

  async fingerprint(primaryKeyJwk, secondaryKeyJwk = null) {
    const x = primaryKeyJwk.x || 'unknown';
    return secondaryKeyJwk ? `fp:${x}+signed` : `fp:${x}`;
  }

  async generateSigningKeyPair() {
    const id = ++counter;
    return {
      publicKey: { _mock: true, id, type: 'signing-public' },
      privateKey: { _mock: true, id, type: 'signing-private' },
    };
  }

  async exportSigningPublicKey(publicKey) {
    return { kty: 'EC', crv: 'P-256', use: 'sig', x: `mock_sig_x_${publicKey.id}`, y: `mock_sig_y_${publicKey.id}` };
  }

  async signPayload(_bytes, _privateKey) {
    return new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  }

  async verifyPayload(_bytes, _signature, _publicKeyJwk) {
    return true;
  }

  // Ratchet stubs — return null to trigger fallback to sharedKey in SessionManager
  async deriveRatchetKeys(_sharedKey, _role) { return null; }
  async advanceChain(_chainKey) { return null; }
}
