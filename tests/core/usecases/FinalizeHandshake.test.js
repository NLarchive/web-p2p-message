import { describe, it, expect } from 'vitest';
import { FinalizeHandshake } from '../../../src/core/usecases/FinalizeHandshake.js';
import { Session, SessionStatus } from '../../../src/core/domain/Session.js';
import { PeerIdentity } from '../../../src/core/domain/PeerIdentity.js';
import { MockCryptoPort } from '../../helpers/MockCryptoPort.js';
import { MockTransportPort } from '../../helpers/MockTransportPort.js';
import { MockSignalingPort } from '../../helpers/MockSignalingPort.js';

describe('FinalizeHandshake', () => {
  function build() {
    const transport = new MockTransportPort();
    const signaling = new MockSignalingPort();
    const crypto = new MockCryptoPort();
    const useCase = new FinalizeHandshake({ transport, signaling, crypto });
    return { useCase, transport, signaling, crypto };
  }

  function makeHostSession() {
    const session = new Session({ id: 'session-abc', role: 'host' });
    session.localIdentity = new PeerIdentity({
      publicKeyJwk: { kty: 'EC', x: 'hx', y: 'hy' },
      fingerprint: 'fp:host',
    });
    session.transition(SessionStatus.AWAITING_ANSWER);
    return session;
  }

  function makeAnswerCode(signaling) {
    return signaling.encodeAnswer({
      sdp: { type: 'answer', sdp: 'mock-answer-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'guest_x', y: 'guest_y' },
      sessionId: 'session-abc',
    });
  }

  it('transitions host session to CONNECTING', async () => {
    const { useCase, signaling } = build();
    const session = makeHostSession();
    const answer = makeAnswerCode(signaling);
    const hostKeyPair = {
      publicKey: { _mock: true },
      privateKey: { _mock: true, id: 1 },
    };

    const result = await useCase.execute(session, answer, hostKeyPair);
    expect(result.status).toBe(SessionStatus.CONNECTING);
  });

  it('sets remote identity on session', async () => {
    const { useCase, signaling } = build();
    const session = makeHostSession();
    const answer = makeAnswerCode(signaling);
    const hostKeyPair = {
      publicKey: { _mock: true },
      privateKey: { _mock: true, id: 1 },
    };

    await useCase.execute(session, answer, hostKeyPair);
    expect(session.remoteIdentity).toBeDefined();
    expect(session.remoteIdentity.publicKeyJwk.x).toBe('guest_x');
  });

  it('derives shared key', async () => {
    const { useCase, signaling } = build();
    const session = makeHostSession();
    const answer = makeAnswerCode(signaling);
    const hostKeyPair = {
      publicKey: { _mock: true },
      privateKey: { _mock: true, id: 1 },
    };

    await useCase.execute(session, answer, hostKeyPair);
    expect(session.sharedKey).toBeDefined();
  });

  it('rejects mismatched session ID', async () => {
    const { useCase, signaling } = build();
    const session = makeHostSession();
    const wrongAnswer = signaling.encodeAnswer({
      sdp: { type: 'answer', sdp: 'sdp' },
      publicKeyJwk: { kty: 'EC', x: 'x', y: 'y' },
      sessionId: 'wrong-id',
    });
    const hostKeyPair = {
      publicKey: { _mock: true },
      privateKey: { _mock: true, id: 1 },
    };

    await expect(
      useCase.execute(session, wrongAnswer, hostKeyPair),
    ).rejects.toThrow('does not match');
  });
});
