import { Session, SessionStatus } from '../domain/Session.js';
import { PeerIdentity } from '../domain/PeerIdentity.js';

export class CreateChatSession {
  constructor({ transport, signaling, identity }) {
    this._transport = transport;
    this._signaling = signaling;
    this._identity = identity;
  }

  async execute() {
    const sessionId = crypto.randomUUID();
    const session = new Session({ id: sessionId, role: 'host' });

    const localId = await this._identity.createIdentity();
    session.localIdentity = new PeerIdentity({
      publicKeyJwk: localId.publicKeyJwk,
      fingerprint: localId.fingerprint,
    });

    const offerSdp = await this._transport.createOffer();

    const inviteCode = this._signaling.encodeOffer({
      sdp: offerSdp,
      publicKeyJwk: localId.publicKeyJwk,
      sessionId,
      createdAt: session.createdAt,
    });

    session.transition(SessionStatus.AWAITING_ANSWER);

    return { session, inviteCode, keyPair: localId.keyPair };
  }
}
