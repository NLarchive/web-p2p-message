import { IIdentityPort } from '../../core/ports/IIdentityPort.js';

export class EphemeralIdentityAdapter extends IIdentityPort {
  constructor({ crypto }) {
    super();
    this._crypto = crypto;
  }

  async createIdentity() {
    const keyPair = await this._crypto.generateKeyPair();
    const publicKeyJwk = await this._crypto.exportPublicKey(keyPair.publicKey);
    const fingerprint = await this._crypto.fingerprint(publicKeyJwk);
    return { publicKeyJwk, fingerprint, keyPair };
  }
}
