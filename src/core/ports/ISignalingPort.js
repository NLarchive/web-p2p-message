/**
 * @interface ISignalingPort
 * Encodes and decodes signaling payloads for the WebRTC handshake.
 * Signaling data is untrusted — adapters must validate structure.
 */
export class ISignalingPort {
  /**
   * @param {{ sdp: object, publicKeyJwk: object, sessionId: string, createdAt: number }} payload
   * @returns {string} encoded offer
   */
  encodeOffer(payload) {
    throw new Error('Not implemented');
  }

  /**
   * @param {string} encoded
   * @returns {{ sdp: object, publicKeyJwk: object, sessionId: string, createdAt: number }}
   */
  decodeOffer(encoded) {
    throw new Error('Not implemented');
  }

  /**
   * @param {{ sdp: object, publicKeyJwk: object, sessionId: string }} payload
   * @returns {string} encoded answer
   */
  encodeAnswer(payload) {
    throw new Error('Not implemented');
  }

  /**
   * @param {string} encoded
   * @returns {{ sdp: object, publicKeyJwk: object, sessionId: string }}
   */
  decodeAnswer(encoded) {
    throw new Error('Not implemented');
  }
}
