import { describe, it, expect } from 'vitest';
import { Session, SessionStatus } from '../../../src/core/domain/Session.js';
import { PeerIdentity } from '../../../src/core/domain/PeerIdentity.js';

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

  it('rejects a counter jump exceeding the max-skip window', () => {
    const s = new Session({ id: 'skip', role: 'host' });
    expect(s.validateReceivedCounter(1)).toBe(true);
    expect(s.validateReceivedCounter(10_002)).toBe(false); // jump > 10_000
    expect(s.validateReceivedCounter(5)).toBe(true);       // normal after failed probe
  });

  it('rejects non-finite counter values', () => {
    const s = new Session({ id: 'inf-counter', role: 'host' });
    expect(s.validateReceivedCounter(Infinity)).toBe(false);
    expect(s.validateReceivedCounter(-1)).toBe(false);
    expect(s.validateReceivedCounter(0)).toBe(false);
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

  // ── New features ──

  it('supports title field', () => {
    const s = new Session({ id: 'title-test', role: 'host' });
    expect(s.title).toBeNull();
    s.title = 'Work Chat';
    expect(s.title).toBe('Work Chat');
    expect(s.toJSON().title).toBe('Work Chat');
  });

  it('allows reconnection from DISCONNECTED to CONNECTING', () => {
    const s = new Session({ id: 'recon', role: 'host' });
    s.transition(SessionStatus.AWAITING_ANSWER);
    s.transition(SessionStatus.CONNECTING);
    s.transition(SessionStatus.CONNECTED);
    s.transition(SessionStatus.DISCONNECTED);
    // Should not throw
    s.transition(SessionStatus.CONNECTING);
    expect(s.status).toBe(SessionStatus.CONNECTING);
  });

  it('allows full reconnection cycle', () => {
    const s = new Session({ id: 'cycle', role: 'guest' });
    s.transition(SessionStatus.AWAITING_FINALIZE);
    s.transition(SessionStatus.CONNECTING);
    s.transition(SessionStatus.CONNECTED);
    s.transition(SessionStatus.DISCONNECTED);
    s.transition(SessionStatus.CONNECTING);
    s.transition(SessionStatus.CONNECTED);
    expect(s.isActive).toBe(true);
  });

  it('skips expiry check for DISCONNECTED sessions during reconnection', () => {
    const s = new Session({
      id: 'recon-exp',
      role: 'host',
      createdAt: Date.now() - 600_000,
      expiryMs: 300_000,
    });
    // Force to DISCONNECTED state
    s.status = SessionStatus.DISCONNECTED;
    expect(s.isExpired).toBe(true);
    // Should still allow reconnection
    s.transition(SessionStatus.CONNECTING);
    expect(s.status).toBe(SessionStatus.CONNECTING);
  });

  it('serializes and deserializes', () => {
    const s = new Session({ id: 'ser', role: 'host' });
    s.title = 'Test Chat';
    s.localIdentity = new PeerIdentity({
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' },
      fingerprint: 'aa:bb:cc',
    });
    s.remoteIdentity = new PeerIdentity({
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'c', y: 'd' },
      fingerprint: 'dd:ee:ff',
    });
    s.messageCounter = 5;
    s._lastReceivedCounter = 3;
    s.status = SessionStatus.CONNECTED;

    const data = s.toSerializable();
    expect(data.privateKeyJwk).toBeUndefined();
    expect(data.rootKey).toBeUndefined();
    expect(data.sendChainKey).toBeUndefined();
    expect(data.receiveChainKey).toBeUndefined();

    const secretData = s.toSerializable({ includeSecrets: true, privateKeyJwk: { kty: 'EC', d: 'privateData' } });
    expect(secretData.privateKeyJwk.d).toBe('privateData');
    expect(secretData.rootKey).toBeNull();

    const { session: restored, privateKeyJwk } = Session.fromSerializable(secretData, { includeSecrets: true });

    expect(restored.id).toBe('ser');
    expect(restored.role).toBe('host');
    expect(restored.title).toBe('Test Chat');
    expect(restored.status).toBe(SessionStatus.DISCONNECTED); // connected → disconnected on restore
    expect(restored.messageCounter).toBe(5);
    expect(restored.localIdentity.fingerprint).toBe('aa:bb:cc');
    expect(restored.remoteIdentity.fingerprint).toBe('dd:ee:ff');
    expect(privateKeyJwk.d).toBe('privateData');
  });

  it('restores disconnected sessions as disconnected', () => {
    const s = new Session({ id: 'disc', role: 'guest' });
    s.status = SessionStatus.DISCONNECTED;
    const data = s.toSerializable();
    const { session: restored } = Session.fromSerializable(data);
    expect(restored.status).toBe(SessionStatus.DISCONNECTED);
  });

  it('omits secret material from default serialization', () => {
    const s = new Session({ id: 'pub', role: 'host' });
    s.rootKey = new Uint8Array([1, 2, 3]);
    s.sendChainKey = new Uint8Array([4, 5, 6]);
    s.receiveChainKey = new Uint8Array([7, 8, 9]);
    s.dhRatchetPrivateKeyJwk = { kty: 'EC', d: 'secret' };
    const data = s.toSerializable();
    expect(data.rootKey).toBeUndefined();
    expect(data.sendChainKey).toBeUndefined();
    expect(data.receiveChainKey).toBeUndefined();
    expect(data.dhRatchetPrivateKeyJwk).toBeUndefined();
  });
});
