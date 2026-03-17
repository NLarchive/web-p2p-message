import { ITransportPort } from '../../core/ports/ITransportPort.js';

/**
 * Transport adapter for same-origin tab communication via BroadcastChannel.
 * Useful for local development, testing, and same-browser collaboration.
 */
export class BroadcastChannelAdapter extends ITransportPort {
  constructor({ channelName = 'p2p-message' } = {}) {
    super();
    this._channelName = channelName;
    this._channel = null;
    this._messageCallbacks = [];
    this._stateCallbacks = [];
    this._state = 'new';
  }

  get state() {
    return this._state;
  }

  async createOffer() {
    this._open();
    return { type: 'offer', sdp: `broadcast:${this._channelName}` };
  }

  async acceptOffer(_offerSdp) {
    this._open();
    return { type: 'answer', sdp: `broadcast:${this._channelName}` };
  }

  async acceptAnswer(_answerSdp) {
    // Both sides are already connected via BroadcastChannel
  }

  send(data) {
    if (!this._channel) throw new Error('Channel not open');
    this._channel.postMessage(data);
  }

  onMessage(callback) {
    this._messageCallbacks.push(callback);
  }

  onStateChange(callback) {
    this._stateCallbacks.push(callback);
  }

  close() {
    if (this._channel) {
      this._channel.close();
      this._channel = null;
    }
    this._setState('disconnected');
  }

  _open() {
    if (this._channel) return;
    this._channel = new BroadcastChannel(this._channelName);
    this._channel.onmessage = (event) => {
      for (const cb of this._messageCallbacks) {
        cb(event.data);
      }
    };
    this._setState('connected');
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    for (const cb of this._stateCallbacks) {
      cb(state);
    }
  }
}
