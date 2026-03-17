import { describe, it, expect } from 'vitest';
import { ReceiveMessage } from '../../../src/core/usecases/ReceiveMessage.js';
import { Message } from '../../../src/core/domain/Message.js';
import { Session, SessionStatus } from '../../../src/core/domain/Session.js';
import { MockCryptoPort } from '../../helpers/MockCryptoPort.js';

describe('ReceiveMessage', () => {
  function build() {
    const crypto = new MockCryptoPort();
    const useCase = new ReceiveMessage({ crypto });
    return { useCase, crypto };
  }

  function connectedSession() {
    const s = new Session({ id: 's1', role: 'guest' });
    s.sharedKey = { _mock: true, type: 'shared' };
    s.transition(SessionStatus.AWAITING_FINALIZE);
    s.transition(SessionStatus.CONNECTING);
    s.transition(SessionStatus.CONNECTED);
    return s;
  }

  function mockEncrypt(plaintext) {
    return `enc:${plaintext}`;
  }

  it('decrypts and returns a Message', async () => {
    const { useCase } = build();
    const session = connectedSession();

    const msg = new Message({
      id: 'msg1',
      text: 'hello',
      from: 'fp:remote',
      counter: 1,
    });
    const encrypted = mockEncrypt(msg.toPlaintext());

    const result = await useCase.execute(session, encrypted);
    expect(result.text).toBe('hello');
    expect(result.counter).toBe(1);
    expect(result.from).toBe('fp:remote');
  });

  it('validates counter is advancing', async () => {
    const { useCase } = build();
    const session = connectedSession();

    const m1 = new Message({
      id: 'm1',
      text: 'first',
      from: 'fp:r',
      counter: 1,
    });
    await useCase.execute(session, mockEncrypt(m1.toPlaintext()));

    // Replay same counter
    const replay = new Message({
      id: 'm2',
      text: 'replayed',
      from: 'fp:r',
      counter: 1,
    });
    await expect(
      useCase.execute(session, mockEncrypt(replay.toPlaintext())),
    ).rejects.toThrow('replay');
  });

  it('rejects when session is not connected', async () => {
    const { useCase } = build();
    const session = new Session({ id: 's', role: 'guest' });
    await expect(useCase.execute(session, 'data')).rejects.toThrow(
      'not connected',
    );
  });
});
