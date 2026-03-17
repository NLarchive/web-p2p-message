import { SESSION_EXPIRY_MS } from '../../shared/validation/constraints.js';

export const SessionStatus = Object.freeze({
  CREATED: 'created',
  AWAITING_ANSWER: 'awaiting_answer',
  AWAITING_FINALIZE: 'awaiting_finalize',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  EXPIRED: 'expired',
  ERROR: 'error',
});

const VALID_TRANSITIONS = {
  [SessionStatus.CREATED]: [
    SessionStatus.AWAITING_ANSWER,
    SessionStatus.AWAITING_FINALIZE,
    SessionStatus.EXPIRED,
    SessionStatus.ERROR,
  ],
  [SessionStatus.AWAITING_ANSWER]: [
    SessionStatus.CONNECTING,
    SessionStatus.EXPIRED,
    SessionStatus.ERROR,
  ],
  [SessionStatus.AWAITING_FINALIZE]: [
    SessionStatus.CONNECTING,
    SessionStatus.EXPIRED,
    SessionStatus.ERROR,
  ],
  [SessionStatus.CONNECTING]: [
    SessionStatus.CONNECTED,
    SessionStatus.DISCONNECTED,
    SessionStatus.ERROR,
  ],
  [SessionStatus.CONNECTED]: [
    SessionStatus.DISCONNECTED,
    SessionStatus.ERROR,
  ],
  [SessionStatus.DISCONNECTED]: [],
  [SessionStatus.EXPIRED]: [],
  [SessionStatus.ERROR]: [],
};

export class Session {
  constructor({ id, role, createdAt = Date.now(), expiryMs = SESSION_EXPIRY_MS }) {
    this.id = id;
    this.role = role;
    this.status = SessionStatus.CREATED;
    this.createdAt = createdAt;
    this.expiryMs = expiryMs;
    this.localIdentity = null;
    this.remoteIdentity = null;
    this.sharedKey = null;
    this.messageCounter = 0;
    this._lastReceivedCounter = 0;
    this.errorReason = null;
  }

  get isExpired() {
    return Date.now() - this.createdAt > this.expiryMs;
  }

  get isActive() {
    return this.status === SessionStatus.CONNECTED;
  }

  transition(newStatus) {
    if (
      this.isExpired &&
      newStatus !== SessionStatus.EXPIRED &&
      newStatus !== SessionStatus.ERROR
    ) {
      this.status = SessionStatus.EXPIRED;
      throw new Error(`Session ${this.id} has expired`);
    }
    const allowed = VALID_TRANSITIONS[this.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition from ${this.status} to ${newStatus}`,
      );
    }
    this.status = newStatus;
  }

  nextMessageCounter() {
    return ++this.messageCounter;
  }

  validateReceivedCounter(counter) {
    if (counter <= this._lastReceivedCounter) return false;
    this._lastReceivedCounter = counter;
    return true;
  }

  setError(reason) {
    this.errorReason = reason;
    this.status = SessionStatus.ERROR;
  }

  toJSON() {
    return {
      id: this.id,
      role: this.role,
      status: this.status,
      createdAt: this.createdAt,
      localFingerprint: this.localIdentity?.fingerprint ?? null,
      remoteFingerprint: this.remoteIdentity?.fingerprint ?? null,
    };
  }
}
