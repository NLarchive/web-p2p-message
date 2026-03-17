/**
 * @interface ICryptoPort
 * Cryptographic operations for key exchange and message encryption.
 * All crypto adapters must implement every method.
 */
export class ICryptoPort {
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

  /** @returns {Promise<CryptoKey>} derived shared symmetric key */
  async deriveSharedKey(privateKey, remotePublicKey) {
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
