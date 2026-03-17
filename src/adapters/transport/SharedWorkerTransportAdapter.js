import { ITransportPort } from '../../core/ports/ITransportPort.js';
import { TransportError } from '../../shared/errors/AppErrors.js';

/**
 * Transport adapter that proxies WebRTC commands through the shared worker
 * via a WorkerRouter. The shared worker holds the RTCPeerConnection instances
 * so they survive page refreshes.
 *
 * @param {string}      sessionId     - Unique session identifier.
 * @param {WorkerRouter} router       - Message router for the shared worker.
 * @param {object}      [opts]
 * @param {boolean}     [opts.isRehydration=false] - True when re-attaching to
 *   an existing connection after a page refresh; sends a 'subscribe' command
 *   instead of creating a new RTCPeerConnection.
 */
export class SharedWorkerTransportAdapter extends ITransportPort {
  constructor(sessionId, router, { isRehydration = false } = {}) {
    super();
    this._sessionId = sessionId;
    this._router = router;
    this._messageCallbacks = [];
    this._stateCallbacks = [];
    this._state = 'new';
    this._offerResolve = null;
    this._offerReject = null;
    this._answerResolve = null;
    this._answerReject = null;

    router.register(sessionId, this._onWorkerMessage.bind(this));

    if (isRehydration) {
      router.send({ cmd: 'subscribe', sessionId });
    }
  }

  get state() {
    return this._state;
  }

  _onWorkerMessage(msg) {
    switch (msg.type) {
      case 'state':
        this._setState(msg.state);
        break;
      case 'message':
        for (const cb of this._messageCallbacks) cb(msg.payload);
        break;
      case 'offer':
        if (this._offerResolve) {
          this._offerResolve(msg.offer);
          this._clearOfferCallbacks();
        }
        break;
      case 'answer':
        if (this._answerResolve) {
          this._answerResolve(msg.answer);
          this._clearAnswerCallbacks();
        }
        break;
      case 'error':
        if (this._offerReject) {
          this._offerReject(new TransportError(msg.error));
          this._clearOfferCallbacks();
        } else if (this._answerReject) {
          this._answerReject(new TransportError(msg.error));
          this._clearAnswerCallbacks();
        }
        break;
    }
  }

  _clearOfferCallbacks() {
    this._offerResolve = null;
    this._offerReject = null;
  }

  _clearAnswerCallbacks() {
    this._answerResolve = null;
    this._answerReject = null;
  }

  async createOffer() {
    return new Promise((resolve, reject) => {
      this._offerResolve = resolve;
      this._offerReject = reject;
      this._router.send({ cmd: 'create-offer', sessionId: this._sessionId });
    });
  }

  async acceptOffer(offerSdp) {
    return new Promise((resolve, reject) => {
      this._answerResolve = resolve;
      this._answerReject = reject;
      this._router.send({
        cmd: 'accept-offer',
        sessionId: this._sessionId,
        data: { offerSdp },
      });
    });
  }

  async acceptAnswer(answerSdp) {
    this._router.send({
      cmd: 'accept-answer',
      sessionId: this._sessionId,
      data: { answerSdp },
    });
  }

  send(data) {
    this._router.send({
      cmd: 'send',
      sessionId: this._sessionId,
      data: { payload: data },
    });
  }

  onMessage(callback) {
    this._messageCallbacks.push(callback);
  }

  onStateChange(callback) {
    this._stateCallbacks.push(callback);
  }

  close() {
    this._router.send({ cmd: 'close', sessionId: this._sessionId });
    this._router.unregister(this._sessionId);
    this._setState('disconnected');
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    for (const cb of this._stateCallbacks) cb(state);
  }
}
