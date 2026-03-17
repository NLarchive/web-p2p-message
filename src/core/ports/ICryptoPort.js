/**
 * @interface ICryptoPort
 * Cryptographic operations for key exchange and message encryption.
 * All crypto adapters must implement every method.
 */
export class ICryptoPort {
  get handshakeMode() {
    return 'dh';
  }

  /** @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>} */
  async generateKeyPair() {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<object>} JWK representation of the public key */
  async exportPublicKey(publicKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<CryptoKey>} imported CryptoKey from JWK */
  async importPublicKey(jwk) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<object>} serializable private key representation */
  async exportPrivateKey(privateKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<*>} imported private key material */
  async importPrivateKey(serialized) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<CryptoKey>} derived shared symmetric key */
  async deriveSharedKey(privateKey, remotePublicKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<{ sharedKey: CryptoKey, cipherText: string }>} */
  async encapsulateSharedKey(remotePublicKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<CryptoKey>} */
  async decapsulateSharedKey(privateKey, cipherText) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<string>} serialized shared key for persistence */
  async exportSharedKey(sharedKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<CryptoKey>} restored shared key */
  async importSharedKey(serialized) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<string>} base64url ciphertext with prepended IV */
  async encrypt(plaintext, sharedKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<string>} decrypted plaintext string */
  async decrypt(ciphertext, sharedKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<string>} short hex fingerprint for UI verification */
  async fingerprint(publicKeyJwk) {
    throw new Error('Not implemented');
  }
}
