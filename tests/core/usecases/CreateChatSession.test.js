import { describe, it, expect } from 'vitest';
import { CreateChatSession } from '../../../src/core/usecases/CreateChatSession.js';
import { SessionStatus } from '../../../src/core/domain/Session.js';
import { MockIdentityPort } from '../../helpers/MockIdentityPort.js';
import { MockTransportPort } from '../../helpers/MockTransportPort.js';
import { MockSignalingPort } from '../../helpers/MockSignalingPort.js';

describe('CreateChatSession', () => {
  function build() {
    const transport = new MockTransportPort();
    const signaling = new MockSignalingPort();
    const identity = new MockIdentityPort();
    const useCase = new CreateChatSession({ transport, signaling, identity });
    return { useCase, transport, signaling, identity };
  }

  it('creates a session in AWAITING_ANSWER state', async () => {
    const { useCase } = build();
    const { session } = await useCase.execute();
    expect(session.status).toBe(SessionStatus.AWAITING_ANSWER);
    expect(session.role).toBe('host');
    expect(session.id).toBeDefined();
  });

  it('sets local identity on the session', async () => {
    const { useCase } = build();
    const { session } = await useCase.execute();
    expect(session.localIdentity).toBeDefined();
    expect(session.localIdentity.publicKeyJwk).toBeDefined();
    expect(session.localIdentity.fingerprint).toBeDefined();
  });

  it('returns an invite code', async () => {
    const { useCase } = build();
    const { inviteCode } = await useCase.execute();
    expect(typeof inviteCode).toBe('string');
    expect(inviteCode.length).toBeGreaterThan(0);
  });

  it('returns the key pair for later handshake', async () => {
    const { useCase } = build();
    const { keyPair } = await useCase.execute();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
  });

  it('invite code can be decoded by signaling', async () => {
    const { useCase, signaling } = build();
    const { inviteCode, session } = await useCase.execute();
    const decoded = signaling.decodeOffer(inviteCode);
    expect(decoded.sessionId).toBe(session.id);
    expect(decoded.sdp).toBeDefined();
    expect(decoded.publicKeyJwk).toBeDefined();
  });
});
