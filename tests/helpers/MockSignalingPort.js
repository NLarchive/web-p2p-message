import { ISignalingPort } from '../../src/core/ports/ISignalingPort.js';

export class MockSignalingPort extends ISignalingPort {
  encodeOffer({ sdp, publicKeyJwk, sessionId, createdAt, signingPublicKeyJwk, signature }) {
    return JSON.stringify({
      type: 'offer',
      sdp,
      publicKeyJwk,
      sessionId,
      createdAt,
      signingPublicKeyJwk: signingPublicKeyJwk ?? null,
      signature: signature ?? null,
    });
  }

  decodeOffer(encoded) {
    const data = JSON.parse(encoded);
    return {
      sdp: data.sdp,
      publicKeyJwk: data.publicKeyJwk,
      sessionId: data.sessionId,
      createdAt: data.createdAt,
      signingPublicKeyJwk: data.signingPublicKeyJwk ?? null,
      signature: data.signature ?? null,
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
