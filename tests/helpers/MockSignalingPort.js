import { ISignalingPort } from '../../src/core/ports/ISignalingPort.js';

export class MockSignalingPort extends ISignalingPort {
  encodeOffer({ sdp, publicKeyJwk, sessionId, createdAt }) {
    return JSON.stringify({
      type: 'offer',
      sdp,
      publicKeyJwk,
      sessionId,
      createdAt,
    });
  }

  decodeOffer(encoded) {
    const data = JSON.parse(encoded);
    return {
      sdp: data.sdp,
      publicKeyJwk: data.publicKeyJwk,
      sessionId: data.sessionId,
      createdAt: data.createdAt,
    };
  }

  encodeAnswer({ sdp, publicKeyJwk, sessionId }) {
    return JSON.stringify({ type: 'answer', sdp, publicKeyJwk, sessionId });
  }

  decodeAnswer(encoded) {
    const data = JSON.parse(encoded);
    return {
      sdp: data.sdp,
      publicKeyJwk: data.publicKeyJwk,
      sessionId: data.sessionId,
    };
  }
}
