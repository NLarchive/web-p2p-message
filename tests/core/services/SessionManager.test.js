import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/core/services/SessionManager.js';
import { SessionStatus } from '../../../src/core/domain/Session.js';
import { ControlAction } from '../../../src/core/domain/Envelope.js';
import { MockCryptoPort } from '../../helpers/MockCryptoPort.js';
import { MockSignalingPort } from '../../helpers/MockSignalingPort.js';
import { MockIdentityPort } from '../../helpers/MockIdentityPort.js';
import { MockStoragePort } from '../../helpers/MockStoragePort.js';
import { MockTransportPort } from '../../helpers/MockTransportPort.js';

// Mock crypto.subtle.exportKey for mock keys
const origExportKey = crypto.subtle.exportKey.bind(crypto.subtle);
vi.spyOn(crypto.subtle, 'exportKey').mockImplementation(async (format, key) => {
  if (key?._mock) {
    return { kty: 'EC', crv: 'P-256', d: `mock_d_${key.id}`, x: `mock_x_${key.id}`, y: `mock_y_${key.id}` };
  }
  return origExportKey(format, key);
});

function createManager() {
  const transports = [];
  const manager = new SessionManager({
    crypto: new MockCryptoPort(),
    signaling: new MockSignalingPort(),
    identity: new MockIdentityPort(),
    storage: new MockStoragePort(),
    createTransport: () => {
      const t = new MockTransportPort();
      transports.push(t);
      return t;
    },
  });
  return { manager, transports };
}

describe('SessionManager', () => {
  it('creates a session and returns invite code', async () => {
    const { manager } = createManager();
    const { sessionId, inviteCode } = await manager.createSession('Test');
    expect(sessionId).toBeTruthy();
    expect(inviteCode).toBeTruthy();

    const s = manager.getSession(sessionId);
    expect(s.title).toBe('Test');
    expect(s.status).toBe(SessionStatus.AWAITING_ANSWER);
    expect(s.role).toBe('host');
  });

  it('joins a session and returns answer code', async () => {
    const { manager, transports } = createManager();
    const { sessionId: hostId, inviteCode } = await manager.createSession('Host Chat');
    const { sessionId: guestId, answerCode } = await manager.joinSession(inviteCode);

    expect(guestId).toBe(hostId);
    expect(answerCode).toBeTruthy();

    const s = manager.getSession(guestId);
    expect(s.title).toBeNull(); // title syncs from host after connection
    expect(s.role).toBe('guest');
    expect(s.status).toBe(SessionStatus.AWAITING_FINALIZE);
  });

  it('finalizes a session', async () => {
    const { manager, transports } = createManager();
    const { sessionId, inviteCode } = await manager.createSession('Chat');
    const { answerCode } = await manager.joinSession(inviteCode);

    await manager.finalizeSession(sessionId, answerCode);
    const s = manager.getSession(sessionId);
    expect(s.status).toBe(SessionStatus.CONNECTING);
  });

  it('connects when transport state changes to connected', async () => {
    const { manager, transports } = createManager();
    const { sessionId } = await manager.createSession('Chat');

    // Construct a mock answer code directly (simulating guest response)
    const answerCode = JSON.stringify({
      type: 'answer',
      sdp: { type: 'answer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'peer_x', y: 'peer_y' },
      sessionId,
    });

    const updates = [];
    manager.on('update', (id) => updates.push(id));

    await manager.finalizeSession(sessionId, answerCode);
    transports[0].simulateStateChange('connected');

    const s = manager.getSession(sessionId);
    expect(s.status).toBe(SessionStatus.CONNECTED);
    expect(updates).toContain(sessionId);
  });

  it('sends and receives messages', async () => {
    const { manager, transports } = createManager();
    const { sessionId } = await manager.createSession('Chat');
    const answerCode = JSON.stringify({
      type: 'answer',
      sdp: { type: 'answer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'peer_x', y: 'peer_y' },
      sessionId,
    });
    await manager.finalizeSession(sessionId, answerCode);
    transports[0].simulateStateChange('connected');

    const received = [];
    manager.on('message', (id, msg, isSelf) => received.push({ id, msg, isSelf }));

    // Send a message
    const sent = await manager.sendMessage(sessionId, 'Hello!');
    expect(sent.text).toBe('Hello!');
    // Title sent on connect + 1 message
    expect(transports[0].sent.length).toBeGreaterThanOrEqual(1);

    // Simulate receiving a message from peer
    const peerMsg = JSON.stringify({
      t: 'm',
      d: { id: 'r1', text: 'Hi back!', from: 'peer-fp', timestamp: Date.now(), counter: 1 },
    });
    transports[0].simulateMessage(`enc:${peerMsg}`);

    // Wait for async handler
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('manages multiple sessions', async () => {
    const { manager } = createManager();
    await manager.createSession('Chat 1');
    await manager.createSession('Chat 2');
    await manager.createSession('Chat 3');

    expect(manager.getSessions().length).toBe(3);
    const titles = manager.getSessions().map((s) => s.title);
    expect(titles).toContain('Chat 1');
    expect(titles).toContain('Chat 2');
    expect(titles).toContain('Chat 3');
  });

  it('deletes a session', async () => {
    const { manager } = createManager();
    const { sessionId } = await manager.createSession('To Delete');
    expect(manager.getSessions().length).toBe(1);
    await manager.deleteSession(sessionId);
    expect(manager.getSessions().length).toBe(0);
  });

  it('disconnects a connected session', async () => {
    const { manager, transports } = createManager();
    const { sessionId } = await manager.createSession('Chat');
    const answerCode = JSON.stringify({
      type: 'answer',
      sdp: { type: 'answer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'peer_x', y: 'peer_y' },
      sessionId,
    });
    await manager.finalizeSession(sessionId, answerCode);
    transports[0].simulateStateChange('connected');

    manager.disconnect(sessionId);
    const s = manager.getSession(sessionId);
    expect(s.status).toBe(SessionStatus.DISCONNECTED);
  });

  it('updates title', async () => {
    const { manager } = createManager();
    const { sessionId } = await manager.createSession('Old Title');
    await manager.sendTitle(sessionId, 'New Title');
    expect(manager.getSession(sessionId).title).toBe('New Title');
  });

  it('persists and restores sessions', async () => {
    const storage = new MockStoragePort();
    const transports1 = [];
    const manager1 = new SessionManager({
      crypto: new MockCryptoPort(),
      signaling: new MockSignalingPort(),
      identity: new MockIdentityPort(),
      storage,
      createTransport: () => {
        const t = new MockTransportPort();
        transports1.push(t);
        return t;
      },
    });

    const { sessionId } = await manager1.createSession('Persistent Chat');
    const { inviteCode } = await manager1.createSession('Another Chat');

    // Create a new manager with the same storage
    const manager2 = new SessionManager({
      crypto: new MockCryptoPort(),
      signaling: new MockSignalingPort(),
      identity: new MockIdentityPort(),
      storage,
      createTransport: () => new MockTransportPort(),
    });

    await manager2.loadSessions();
    expect(manager2.getSessions().length).toBe(2);
    const titles = manager2.getSessions().map((s) => s.title);
    expect(titles).toContain('Persistent Chat');
    expect(titles).toContain('Another Chat');
  });

  it('handles delete request protocol', async () => {
    const { manager, transports } = createManager();
    const { sessionId } = await manager.createSession('Chat');
    const answerCode = JSON.stringify({
      type: 'answer',
      sdp: { type: 'answer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'peer_x', y: 'peer_y' },
      sessionId,
    });
    await manager.finalizeSession(sessionId, answerCode);
    transports[0].simulateStateChange('connected');

    const controlEvents = [];
    manager.on('control', (id, action, data) => controlEvents.push({ id, action, data }));

    await manager.requestDelete(sessionId);
    expect(transports[0].sent.length).toBeGreaterThan(0);
  });

  it('handles incoming delete confirm by removing session', async () => {
    const { manager, transports } = createManager();
    const { sessionId } = await manager.createSession('Chat');
    const answerCode = JSON.stringify({
      type: 'answer',
      sdp: { type: 'answer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'peer_x', y: 'peer_y' },
      sessionId,
    });
    await manager.finalizeSession(sessionId, answerCode);
    transports[0].simulateStateChange('connected');

    // Simulate receiving a delete_ack
    const ack = JSON.stringify({ t: 'c', a: 'delete_ack', d: {} });
    transports[0].simulateMessage(`enc:${ack}`);

    await new Promise((r) => setTimeout(r, 10));
    expect(manager.getSession(sessionId)).toBeNull();
  });

  it('emits update events', async () => {
    const { manager } = createManager();
    const updates = [];
    manager.on('update', (id) => updates.push(id));
    const { sessionId } = await manager.createSession('Chat');
    expect(updates).toContain(sessionId);
  });

  it('gets messages for a session', async () => {
    const { manager, transports } = createManager();
    const { sessionId } = await manager.createSession('Chat');
    const answerCode = JSON.stringify({
      type: 'answer',
      sdp: { type: 'answer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'peer_x', y: 'peer_y' },
      sessionId,
    });
    await manager.finalizeSession(sessionId, answerCode);
    transports[0].simulateStateChange('connected');

    await manager.sendMessage(sessionId, 'First');
    await manager.sendMessage(sessionId, 'Second');

    const msgs = manager.getMessages(sessionId);
    expect(msgs.length).toBe(2);
    expect(msgs[0].text).toBe('First');
    expect(msgs[1].text).toBe('Second');
  });
});
