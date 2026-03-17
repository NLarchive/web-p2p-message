import { describe, it, expect } from 'vitest';
import { JoinChatSession } from '../../../src/core/usecases/JoinChatSession.js';
import { SessionStatus } from '../../../src/core/domain/Session.js';
import { MockCryptoPort } from '../../helpers/MockCryptoPort.js';
import { MockIdentityPort } from '../../helpers/MockIdentityPort.js';
import { MockTransportPort } from '../../helpers/MockTransportPort.js';
import { MockSignalingPort } from '../../helpers/MockSignalingPort.js';

describe('JoinChatSession', () => {
  function build() {
    const transport = new MockTransportPort();
    const signaling = new MockSignalingPort();
    const crypto = new MockCryptoPort();
    const identity = new MockIdentityPort();
    const useCase = new JoinChatSession({
      transport,
      signaling,
      crypto,
      identity,
    });
    return { useCase, transport, signaling, crypto, identity };
  }

  function makeInvite(signaling) {
    return signaling.encodeOffer({
      sdp: { type: 'offer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'host_x', y: 'host_y' },
      sessionId: 'session-abc',
      createdAt: Date.now(),
    });
  }

  it('creates a guest session in AWAITING_FINALIZE state', async () => {
    const { useCase, signaling } = build();
    const invite = makeInvite(signaling);
    const { session } = await useCase.execute(invite);
    expect(session.role).toBe('guest');
    expect(session.status).toBe(SessionStatus.AWAITING_FINALIZE);
  });

  it('sets both local and remote identities', async () => {
    const { useCase, signaling } = build();
    const invite = makeInvite(signaling);
    const { session } = await useCase.execute(invite);
    expect(session.localIdentity).toBeDefined();
    expect(session.remoteIdentity).toBeDefined();
    expect(session.localIdentity.fingerprint).not.toBe(
      session.remoteIdentity.fingerprint,
    );
  });

  it('derives a shared key', async () => {
    const { useCase, signaling } = build();
    const invite = makeInvite(signaling);
    const { session } = await useCase.execute(invite);
    expect(session.sharedKey).toBeDefined();
  });

  it('returns an answer code', async () => {
    const { useCase, signaling } = build();
    const invite = makeInvite(signaling);
    const { answerCode } = await useCase.execute(invite);
    expect(typeof answerCode).toBe('string');
    expect(answerCode.length).toBeGreaterThan(0);
  });

  it('answer code contains guest public key', async () => {
    const { useCase, signaling } = build();
    const invite = makeInvite(signaling);
    const { answerCode } = await useCase.execute(invite);
    const decoded = signaling.decodeAnswer(answerCode);
    expect(decoded.publicKeyJwk).toBeDefined();
    expect(decoded.sessionId).toBe('session-abc');
  });
});
