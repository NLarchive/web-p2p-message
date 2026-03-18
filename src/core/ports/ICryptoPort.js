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

  /** @returns {Promise<string>} hex fingerprint; pass a second JWK to cover both keys */
  async fingerprint(primaryKeyJwk, secondaryKeyJwk = null) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<{publicKey, privateKey}>} ECDSA P-256 signing key pair */
  async generateSigningKeyPair() {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<object>} JWK representation of the ECDSA signing public key */
  async exportSigningPublicKey(publicKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<Uint8Array>} ECDSA-SHA256 signature over the byte array */
  async signPayload(bytes, privateKey) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<boolean>} true if signature is valid */
  async verifyPayload(bytes, signature, publicKeyJwk) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<{sendChainKey: Uint8Array, receiveChainKey: Uint8Array}>} */
  async deriveRatchetKeys(sharedKey, role) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<{messageKey: CryptoKey, nextChainKey: Uint8Array}>} */
  async advanceChain(chainKeyBytes) {
    throw new Error('Not implemented');
  }

  /**
   * Generate an ephemeral P-256 ECDH key pair for the DH ratchet.
   * Both public and private keys are exported as JWK (extractable) so they can
   * be stored in session state and rotated after each ratchet step.
   * @returns {Promise<{publicKeyJwk: object, privateKeyJwk: object}>}
   */
  async generateDhRatchetKeyPair() {
    throw new Error('Not implemented');
  }

  /**
   * Perform a single ECDH exchange between local ratchet private key and remote
   * ratchet public key.  Returns the raw 32-byte X coordinate (P-256 shared secret).
   * @returns {Promise<Uint8Array>}
   */
  async dhRatchetEcdh(myPrivKeyJwk, theirPubKeyJwk) {
    throw new Error('Not implemented');
  }

  /**
   * Advance the root chain using a DH output.  Implements:
   *   HKDF(IKM=dhOutput, salt=rootKeyBytes, info="DR-root-v1") → 64 bytes
   * split into (newRootKey[0..32], newChainKey[32..64]).
   * @returns {Promise<{newRootKey: Uint8Array, newChainKey: Uint8Array}>}
   */
  async advanceRootChain(rootKeyBytes, dhOutput) {
    throw new Error('Not implemented');
  }

  /**
   * Derive the initial root key and directed chain keys from the XWing shared
   * secret combined with a DH ratchet exchange.  Replaces deriveRatchetKeys
   * when both parties have exchanged their initial ratchet public keys.
   * @returns {Promise<{rootKey: Uint8Array, sendChainKey: Uint8Array, receiveChainKey: Uint8Array}>}
   */
  async initDhRatchet(sharedKey, myRatchetPrivKeyJwk, remoteRatchetPubKeyJwk, role) {
    throw new Error('Not implemented');
  }
}
