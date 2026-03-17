import { describe, it, expect } from 'vitest';
import { CreateChatSession } from '../../src/core/usecases/CreateChatSession.js';
import { JoinChatSession } from '../../src/core/usecases/JoinChatSession.js';
import { FinalizeHandshake } from '../../src/core/usecases/FinalizeHandshake.js';
import { SendMessage } from '../../src/core/usecases/SendMessage.js';
import { ReceiveMessage } from '../../src/core/usecases/ReceiveMessage.js';
import { VerifyFingerprint } from '../../src/core/usecases/VerifyFingerprint.js';
import { SessionStatus } from '../../src/core/domain/Session.js';
import { MockCryptoPort } from '../helpers/MockCryptoPort.js';
import { MockIdentityPort } from '../helpers/MockIdentityPort.js';
import { MockTransportPort } from '../helpers/MockTransportPort.js';
import { MockSignalingPort } from '../helpers/MockSignalingPort.js';

describe('Integration: full chat flow', () => {
  it('host creates → guest joins → handshake → send → receive', async () => {
    // Shared mocks (separate transport per peer, shared signaling format)
    const signaling = new MockSignalingPort();
    const cryptoPort = new MockCryptoPort();
    const hostTransport = new MockTransportPort();
    const guestTransport = new MockTransportPort();

    // 1 — Host creates session
    const createSession = new CreateChatSession({
      transport: hostTransport,
      signaling,
      identity: new MockIdentityPort(),
    });
    const {
      session: hostSession,
      inviteCode,
      keyPair: hostKeyPair,
    } = await createSession.execute();

    expect(hostSession.status).toBe(SessionStatus.AWAITING_ANSWER);

    // 2 — Guest joins with invite code
    const joinSession = new JoinChatSession({
      transport: guestTransport,
      signaling,
      crypto: cryptoPort,
      identity: new MockIdentityPort(),
    });
    const { session: guestSession, answerCode } =
      await joinSession.execute(inviteCode);

    expect(guestSession.status).toBe(SessionStatus.AWAITING_FINALIZE);
    expect(guestSession.sharedKey).toBeDefined();

    // 3 — Host finalizes handshake
    const finalize = new FinalizeHandshake({
      transport: hostTransport,
      signaling,
      crypto: cryptoPort,
    });
    await finalize.execute(hostSession, answerCode, hostKeyPair);

    expect(hostSession.status).toBe(SessionStatus.CONNECTING);
    expect(hostSession.sharedKey).toBeDefined();

    // 4 — Simulate connection established
    hostSession.transition(SessionStatus.CONNECTED);
    guestSession.transition(SessionStatus.CONNECTING);
    guestSession.transition(SessionStatus.CONNECTED);

    // 5 — Host sends a message
    const sendMsg = new SendMessage({
      transport: hostTransport,
      crypto: cryptoPort,
    });
    const sentMessage = await sendMsg.execute(hostSession, 'Hello, guest!');
    expect(sentMessage.text).toBe('Hello, guest!');
    expect(sentMessage.counter).toBe(1);
    expect(hostTransport.sent.length).toBe(1);

    // 6 — Guest receives the message
    const receiveMsg = new ReceiveMessage({ crypto: cryptoPort });
    const received = await receiveMsg.execute(
      guestSession,
      hostTransport.sent[0],
    );
    expect(received.text).toBe('Hello, guest!');
    expect(received.counter).toBe(1);

    // 7 — Verify fingerprints
    const verify = new VerifyFingerprint();
    const hostFp = verify.execute(hostSession);
    const guestFp = verify.execute(guestSession);

    expect(hostFp.canVerify).toBe(true);
    expect(guestFp.canVerify).toBe(true);
    expect(hostFp.localFingerprint).toBe(guestFp.remoteFingerprint);
  });
});
