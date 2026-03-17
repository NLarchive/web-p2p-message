import { ITransportPort } from '../../core/ports/ITransportPort.js';
import {
  TransportError,
  ConnectionClosedError,
} from '../../shared/errors/AppErrors.js';

const DATA_CHANNEL_LABEL = 'p2p-message';
const ICE_GATHER_TIMEOUT_MS = 5000;

export class WebRtcTransportAdapter extends ITransportPort {
  constructor({
    iceServers = [{ urls: 'stun:stun.l.google.com:19302' }],
  } = {}) {
    super();
    this._iceServers = iceServers;
    this._pc = null;
    this._dc = null;
    this._messageCallbacks = [];
    this._stateCallbacks = [];
    this._state = 'new';
  }

  get state() {
    return this._state;
  }

  async createOffer() {
    try {
      this._pc = new RTCPeerConnection({ iceServers: this._iceServers });
      this._setupStateHandlers();
      this._dc = this._pc.createDataChannel(DATA_CHANNEL_LABEL);
      this._setupDataChannel(this._dc);
      const offer = await this._pc.createOffer();
      await this._pc.setLocalDescription(offer);
      await this._waitForIceCandidates();
      return this._pc.localDescription.toJSON();
    } catch (e) {
      throw new TransportError(`Failed to create offer: ${e.message}`);
    }
  }

  async acceptOffer(offerSdp) {
    try {
      this._pc = new RTCPeerConnection({ iceServers: this._iceServers });
      this._setupStateHandlers();
      this._pc.ondatachannel = (event) => {
        this._dc = event.channel;
        this._setupDataChannel(this._dc);
      };
      await this._pc.setRemoteDescription(offerSdp);
      const answer = await this._pc.createAnswer();
      await this._pc.setLocalDescription(answer);
      await this._waitForIceCandidates();
      return this._pc.localDescription.toJSON();
    } catch (e) {
      throw new TransportError(`Failed to accept offer: ${e.message}`);
    }
  }

  async acceptAnswer(answerSdp) {
    try {
      if (!this._pc) throw new Error('No peer connection');
      await this._pc.setRemoteDescription(answerSdp);
    } catch (e) {
      throw new TransportError(`Failed to accept answer: ${e.message}`);
    }
  }

  send(data) {
    if (!this._dc || this._dc.readyState !== 'open') {
      throw new ConnectionClosedError('Data channel is not open');
    }
    this._dc.send(data);
  }

  onMessage(callback) {
    this._messageCallbacks.push(callback);
  }

  onStateChange(callback) {
    this._stateCallbacks.push(callback);
  }

  close() {
    if (this._dc) {
      this._dc.close();
      this._dc = null;
    }
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
    this._setState('disconnected');
  }

  _setupDataChannel(dc) {
    dc.onopen = () => this._setState('connected');
    dc.onclose = () => this._setState('disconnected');
    dc.onerror = () => this._setState('disconnected');
    dc.onmessage = (event) => {
      for (const cb of this._messageCallbacks) {
        cb(event.data);
      }
    };
  }

  _setupStateHandlers() {
    this._pc.onconnectionstatechange = () => {
      const s = this._pc.connectionState;
      if (s === 'disconnected' || s === 'failed' || s === 'closed') {
        this._setState('disconnected');
      }
    };
    this._setState('connecting');
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    for (const cb of this._stateCallbacks) {
      cb(state);
    }
  }

  _waitForIceCandidates() {
    return new Promise((resolve) => {
      if (this._pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const onGather = () => {
        if (this._pc.iceGatheringState === 'complete') {
          this._pc.removeEventListener('icegatheringstatechange', onGather);
          resolve();
        }
      };
      this._pc.addEventListener('icegatheringstatechange', onGather);
      setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
    });
  }
}
