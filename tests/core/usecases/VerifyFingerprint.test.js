import { describe, it, expect } from 'vitest';
import { VerifyFingerprint } from '../../../src/core/usecases/VerifyFingerprint.js';
import { Session } from '../../../src/core/domain/Session.js';
import { PeerIdentity } from '../../../src/core/domain/PeerIdentity.js';

describe('VerifyFingerprint', () => {
  const useCase = new VerifyFingerprint();

  it('returns both fingerprints when identities are set', () => {
    const s = new Session({ id: 'v', role: 'host' });
    s.localIdentity = new PeerIdentity({
      publicKeyJwk: { kty: 'EC', x: 'a', y: 'b' },
      fingerprint: 'fp:local',
    });
    s.remoteIdentity = new PeerIdentity({
      publicKeyJwk: { kty: 'EC', x: 'c', y: 'd' },
      fingerprint: 'fp:remote',
    });

    const result = useCase.execute(s);
    expect(result.canVerify).toBe(true);
    expect(result.localFingerprint).toBe('fp:local');
    expect(result.remoteFingerprint).toBe('fp:remote');
  });

  it('returns canVerify=false when identities are missing', () => {
    const s = new Session({ id: 'v2', role: 'host' });
    const result = useCase.execute(s);
    expect(result.canVerify).toBe(false);
    expect(result.localFingerprint).toBeNull();
    expect(result.remoteFingerprint).toBeNull();
  });
});
