import { describe, it, expect } from 'vitest';
import { SendMessage } from '../../../src/core/usecases/SendMessage.js';
import { Session, SessionStatus } from '../../../src/core/domain/Session.js';
import { PeerIdentity } from '../../../src/core/domain/PeerIdentity.js';
import { MockCryptoPort } from '../../helpers/MockCryptoPort.js';
import { MockTransportPort } from '../../helpers/MockTransportPort.js';

describe('SendMessage', () => {
  function build() {
    const transport = new MockTransportPort();
    const crypto = new MockCryptoPort();
    const useCase = new SendMessage({ transport, crypto });
    return { useCase, transport, crypto };
  }

  function connectedSession() {
    const s = new Session({ id: 's1', role: 'host' });
    s.localIdentity = new PeerIdentity({
      publicKeyJwk: { kty: 'EC', x: 'x', y: 'y' },
      fingerprint: 'fp:local',
    });
    s.sharedKey = { _mock: true, type: 'shared' };
    s.transition(SessionStatus.AWAITING_ANSWER);
    s.transition(SessionStatus.CONNECTING);
    s.transition(SessionStatus.CONNECTED);
    return s;
  }

  it('sends an encrypted message', async () => {
    const { useCase, transport } = build();
    const session = connectedSession();

    const msg = await useCase.execute(session, 'Hello!');
    expect(msg.text).toBe('Hello!');
    expect(msg.counter).toBe(1);
    expect(msg.from).toBe('fp:local');
    expect(transport.sent.length).toBe(1);
    expect(transport.sent[0]).toContain('enc:'); // mock encryption prefix
  });

  it('increments message counter', async () => {
    const { useCase } = build();
    const session = connectedSession();

    const m1 = await useCase.execute(session, 'First');
    const m2 = await useCase.execute(session, 'Second');
    expect(m1.counter).toBe(1);
    expect(m2.counter).toBe(2);
  });

  it('rejects when session is not connected', async () => {
    const { useCase } = build();
    const session = new Session({ id: 's2', role: 'host' });
    await expect(useCase.execute(session, 'Hi')).rejects.toThrow(
      'not connected',
    );
  });
});
