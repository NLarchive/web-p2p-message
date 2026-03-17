/**
 * @interface IIdentityPort
 * Manages peer identity creation and key material lifecycle.
 */
export class IIdentityPort {
  /**
   * @returns {Promise<{publicKeyJwk: object, fingerprint: string, keyPair: {publicKey: CryptoKey, privateKey: CryptoKey}}>}
   */
  async createIdentity() {
    throw new Error('Not implemented');
  }
}
