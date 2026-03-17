import { ITransportPort } from '../../src/core/ports/ITransportPort.js';

export class MockTransportPort extends ITransportPort {
  constructor() {
    super();
    this._messageCallbacks = [];
    this._stateCallbacks = [];
    this._state = 'new';
    this.sent = [];
  }

  get state() {
    return this._state;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-sdp-offer' };
  }

  async acceptOffer(_offerSdp) {
    return { type: 'answer', sdp: 'mock-sdp-answer' };
  }

  async acceptAnswer(_answerSdp) {
    // no-op in mock
  }

  send(data) {
    this.sent.push(data);
  }

  onMessage(callback) {
    this._messageCallbacks.push(callback);
  }

  onStateChange(callback) {
    this._stateCallbacks.push(callback);
  }

  close() {
    this._setState('disconnected');
  }

  // --- Test helpers ---

  simulateMessage(data) {
    for (const cb of this._messageCallbacks) cb(data);
  }

  simulateStateChange(state) {
    this._setState(state);
  }

  _setState(state) {
    this._state = state;
    for (const cb of this._stateCallbacks) cb(state);
  }
}
