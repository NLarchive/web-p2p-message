import { IIdentityPort } from '../../src/core/ports/IIdentityPort.js';

let counter = 0;

export class MockIdentityPort extends IIdentityPort {
  async createIdentity() {
    const id = ++counter;
    return {
      publicKeyJwk: {
        kty: 'EC',
        crv: 'P-256',
        x: `mock_x_${id}`,
        y: `mock_y_${id}`,
      },
      fingerprint: `fp:mock_x_${id}`,
      keyPair: {
        publicKey: { _mock: true, id, type: 'public' },
        privateKey: { _mock: true, id, type: 'private' },
      },
    };
  }
}
