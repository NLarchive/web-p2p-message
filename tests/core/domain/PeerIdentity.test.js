import { describe, it, expect } from 'vitest';
import { PeerIdentity } from '../../../src/core/domain/PeerIdentity.js';

describe('PeerIdentity', () => {
  const jwk = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' };

  it('creates with required fields', () => {
    const id = new PeerIdentity({ publicKeyJwk: jwk, fingerprint: 'fp:abc' });
    expect(id.publicKeyJwk).toEqual(jwk);
    expect(id.fingerprint).toBe('fp:abc');
    expect(id.displayName).toBeNull();
  });

  it('accepts optional displayName', () => {
    const id = new PeerIdentity({
      publicKeyJwk: jwk,
      fingerprint: 'fp:abc',
      displayName: 'Alice',
    });
    expect(id.displayName).toBe('Alice');
  });

  it('rejects missing publicKeyJwk', () => {
    expect(
      () => new PeerIdentity({ publicKeyJwk: null, fingerprint: 'fp' }),
    ).toThrow('publicKeyJwk');
  });

  it('rejects missing fingerprint', () => {
    expect(
      () => new PeerIdentity({ publicKeyJwk: jwk, fingerprint: null }),
    ).toThrow('fingerprint');
  });

  it('round-trips through JSON', () => {
    const id = new PeerIdentity({ publicKeyJwk: jwk, fingerprint: 'fp:abc' });
    const restored = PeerIdentity.fromJSON(id.toJSON());
    expect(restored.publicKeyJwk).toEqual(jwk);
    expect(restored.fingerprint).toBe('fp:abc');
  });
});
