import { SESSION_EXPIRY_MS } from '../../shared/validation/constraints.js';
import { PeerIdentity } from './PeerIdentity.js';

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
  [SessionStatus.DISCONNECTED]: [
    SessionStatus.CONNECTING,
    SessionStatus.ERROR,
  ],
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
    this.title = null;
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
    // Skip expiry check for established sessions (DISCONNECTED can reconnect)
    if (
      this.isExpired &&
      this.status !== SessionStatus.DISCONNECTED &&
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
      title: this.title,
      localFingerprint: this.localIdentity?.fingerprint ?? null,
      remoteFingerprint: this.remoteIdentity?.fingerprint ?? null,
    };
  }

  toSerializable(privateKeyJwk) {
    return {
      id: this.id,
      role: this.role,
      status: this.status,
      title: this.title,
      createdAt: this.createdAt,
      expiryMs: this.expiryMs,
      messageCounter: this.messageCounter,
      lastReceivedCounter: this._lastReceivedCounter,
      localIdentity: this.localIdentity?.toJSON() ?? null,
      remoteIdentity: this.remoteIdentity?.toJSON() ?? null,
      privateKeyJwk: privateKeyJwk ?? null,
    };
  }

  static fromSerializable(data) {
    const session = new Session({
      id: data.id,
      role: data.role,
      createdAt: data.createdAt,
      expiryMs: data.expiryMs,
    });
    // Restored sessions that were connected come back as disconnected
    const restoredStatus =
      data.status === SessionStatus.CONNECTED
        ? SessionStatus.DISCONNECTED
        : data.status;
    session.status = restoredStatus;
    session.title = data.title ?? null;
    session.messageCounter = data.messageCounter ?? 0;
    session._lastReceivedCounter = data.lastReceivedCounter ?? 0;
    if (data.localIdentity) {
      session.localIdentity = PeerIdentity.fromJSON(data.localIdentity);
    }
    if (data.remoteIdentity) {
      session.remoteIdentity = PeerIdentity.fromJSON(data.remoteIdentity);
    }
    return { session, privateKeyJwk: data.privateKeyJwk ?? null };
  }
}
