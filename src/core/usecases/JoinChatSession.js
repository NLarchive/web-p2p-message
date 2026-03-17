import { Session, SessionStatus } from '../domain/Session.js';
import { PeerIdentity } from '../domain/PeerIdentity.js';

export class JoinChatSession {
  constructor({ transport, signaling, crypto, identity }) {
    this._transport = transport;
    this._signaling = signaling;
    this._crypto = crypto;
    this._identity = identity;
  }

  async execute(inviteCode) {
    const offer = this._signaling.decodeOffer(inviteCode);

    const session = new Session({
      id: offer.sessionId,
      role: 'guest',
      createdAt: offer.createdAt,
    });

    const localId = await this._identity.createIdentity();
    session.localIdentity = new PeerIdentity({
      publicKeyJwk: localId.publicKeyJwk,
      fingerprint: localId.fingerprint,
    });

    const remotePublicKey = await this._crypto.importPublicKey(
      offer.publicKeyJwk,
    );
    const remoteFingerprint = await this._crypto.fingerprint(
      offer.publicKeyJwk,
    );
    session.remoteIdentity = new PeerIdentity({
      publicKeyJwk: offer.publicKeyJwk,
      fingerprint: remoteFingerprint,
    });

    const sharedKey = await this._crypto.deriveSharedKey(
      localId.keyPair.privateKey,
      remotePublicKey,
    );
    session.sharedKey = sharedKey;

    const answerSdp = await this._transport.acceptOffer(offer.sdp);

    const answerCode = this._signaling.encodeAnswer({
      sdp: answerSdp,
      publicKeyJwk: localId.publicKeyJwk,
      sessionId: session.id,
    });

    session.transition(SessionStatus.AWAITING_FINALIZE);

    return { session, answerCode, keyPair: localId.keyPair };
  }
}
