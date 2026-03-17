/**
 * @interface ITransportPort
 * Manages peer-to-peer data transport lifecycle.
 */
export class ITransportPort {
  /** @returns {Promise<object>} SDP offer */
  async createOffer() {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<object>} SDP answer */
  async acceptOffer(offerSdp) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<void>} */
  async acceptAnswer(answerSdp) {
    throw new Error('Not implemented');
  }

  /** @param {string} data */
  send(data) {
    throw new Error('Not implemented');
  }

  /** @param {function(string): void} callback */
  onMessage(callback) {
    throw new Error('Not implemented');
  }

  /** @param {function(string): void} callback — state: 'connecting' | 'connected' | 'disconnected' */
  onStateChange(callback) {
    throw new Error('Not implemented');
  }

  close() {
    throw new Error('Not implemented');
  }

  /** @returns {string} */
  get state() {
    throw new Error('Not implemented');
  }
}
