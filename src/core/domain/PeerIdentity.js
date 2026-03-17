export class PeerIdentity {
  constructor({ publicKeyJwk, fingerprint, displayName = null }) {
    if (!publicKeyJwk) throw new Error('publicKeyJwk is required');
    if (!fingerprint) throw new Error('fingerprint is required');

    this.publicKeyJwk = publicKeyJwk;
    this.fingerprint = fingerprint;
    this.displayName = displayName;
  }

  toJSON() {
    return {
      publicKeyJwk: this.publicKeyJwk,
      fingerprint: this.fingerprint,
      displayName: this.displayName,
    };
  }

  static fromJSON(data) {
    return new PeerIdentity(data);
  }
}
