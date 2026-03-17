import { describe, it, expect } from 'vitest';
import { Session, SessionStatus } from '../../../src/core/domain/Session.js';

describe('Session', () => {
  it('creates with correct initial state', () => {
    const s = new Session({ id: 'test-1', role: 'host' });
    expect(s.id).toBe('test-1');
    expect(s.role).toBe('host');
    expect(s.status).toBe(SessionStatus.CREATED);
    expect(s.isActive).toBe(false);
    expect(s.messageCounter).toBe(0);
  });

  it('transitions through valid host states', () => {
    const s = new Session({ id: 'h', role: 'host' });
    s.transition(SessionStatus.AWAITING_ANSWER);
    expect(s.status).toBe(SessionStatus.AWAITING_ANSWER);
    s.transition(SessionStatus.CONNECTING);
    s.transition(SessionStatus.CONNECTED);
    expect(s.isActive).toBe(true);
  });

  it('transitions through valid guest states', () => {
    const s = new Session({ id: 'g', role: 'guest' });
    s.transition(SessionStatus.AWAITING_FINALIZE);
    s.transition(SessionStatus.CONNECTING);
    s.transition(SessionStatus.CONNECTED);
    expect(s.isActive).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const s = new Session({ id: 't', role: 'host' });
    expect(() => s.transition(SessionStatus.CONNECTED)).toThrow(
      'Invalid transition',
    );
  });

  it('rejects transitions from terminal states', () => {
    const s = new Session({ id: 't', role: 'host' });
    s.transition(SessionStatus.AWAITING_ANSWER);
    s.transition(SessionStatus.CONNECTING);
    s.transition(SessionStatus.CONNECTED);
    s.transition(SessionStatus.DISCONNECTED);
    expect(() => s.transition(SessionStatus.CONNECTED)).toThrow();
  });

  it('detects expiry', () => {
    const s = new Session({
      id: 'e',
      role: 'host',
      createdAt: Date.now() - 600_000,
      expiryMs: 300_000,
    });
    expect(s.isExpired).toBe(true);
  });

  it('blocks transitions when expired', () => {
    const s = new Session({
      id: 'e2',
      role: 'host',
      createdAt: Date.now() - 600_000,
      expiryMs: 300_000,
    });
    expect(() => s.transition(SessionStatus.AWAITING_ANSWER)).toThrow(
      'expired',
    );
    expect(s.status).toBe(SessionStatus.EXPIRED);
  });

  it('increments message counter', () => {
    const s = new Session({ id: 'c', role: 'host' });
    expect(s.nextMessageCounter()).toBe(1);
    expect(s.nextMessageCounter()).toBe(2);
    expect(s.nextMessageCounter()).toBe(3);
  });

  it('validates received message counters', () => {
    const s = new Session({ id: 'r', role: 'host' });
    expect(s.validateReceivedCounter(1)).toBe(true);
    expect(s.validateReceivedCounter(2)).toBe(true);
    expect(s.validateReceivedCounter(2)).toBe(false); // duplicate
    expect(s.validateReceivedCounter(1)).toBe(false); // replay
    expect(s.validateReceivedCounter(5)).toBe(true); // gap is fine
  });

  it('serializes to JSON', () => {
    const s = new Session({ id: 'j', role: 'guest' });
    const json = s.toJSON();
    expect(json.id).toBe('j');
    expect(json.role).toBe('guest');
    expect(json.status).toBe(SessionStatus.CREATED);
    expect(json.localFingerprint).toBeNull();
    expect(json.remoteFingerprint).toBeNull();
  });

  it('sets error state', () => {
    const s = new Session({ id: 'err', role: 'host' });
    s.setError('Something went wrong');
    expect(s.status).toBe(SessionStatus.ERROR);
    expect(s.errorReason).toBe('Something went wrong');
  });
});
