import { SessionStatus } from '../domain/Session.js';
import { PeerIdentity } from '../domain/PeerIdentity.js';

export class FinalizeHandshake {
  constructor({ transport, signaling, crypto }) {
    this._transport = transport;
    this._signaling = signaling;
    this._crypto = crypto;
  }

  async execute(session, answerCode, hostKeyPair) {
    const answer = this._signaling.decodeAnswer(answerCode);

    if (answer.sessionId !== session.id) {
      throw new Error('Answer session ID does not match');
    }

    const remotePublicKey = await this._crypto.importPublicKey(
      answer.publicKeyJwk,
    );
    const remoteFingerprint = await this._crypto.fingerprint(
      answer.publicKeyJwk,
    );
    session.remoteIdentity = new PeerIdentity({
      publicKeyJwk: answer.publicKeyJwk,
      fingerprint: remoteFingerprint,
    });

    const sharedKey = await this._crypto.deriveSharedKey(
      hostKeyPair.privateKey,
      remotePublicKey,
    );
    session.sharedKey = sharedKey;

    await this._transport.acceptAnswer(answer.sdp);
    session.transition(SessionStatus.CONNECTING);

    return session;
  }
}
