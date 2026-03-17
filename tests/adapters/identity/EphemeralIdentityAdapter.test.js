import { describe, it, expect } from 'vitest';
import { EphemeralIdentityAdapter } from '../../../src/adapters/identity/EphemeralIdentityAdapter.js';
import { WebCryptoEcdhAesGcm } from '../../../src/adapters/crypto/WebCryptoEcdhAesGcm.js';

describe('EphemeralIdentityAdapter', () => {
  it('creates an identity with all required fields', async () => {
    const crypto = new WebCryptoEcdhAesGcm();
    const adapter = new EphemeralIdentityAdapter({ crypto });
    const id = await adapter.createIdentity();

    expect(id.publicKeyJwk).toBeDefined();
    expect(id.publicKeyJwk.kty).toBe('EC');
    expect(id.fingerprint).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/);
    expect(id.keyPair.publicKey).toBeDefined();
    expect(id.keyPair.privateKey).toBeDefined();
  });

  it('creates unique identities each time', async () => {
    const crypto = new WebCryptoEcdhAesGcm();
    const adapter = new EphemeralIdentityAdapter({ crypto });
    const id1 = await adapter.createIdentity();
    const id2 = await adapter.createIdentity();

    expect(id1.fingerprint).not.toBe(id2.fingerprint);
    expect(id1.publicKeyJwk.x).not.toBe(id2.publicKeyJwk.x);
  });
});
