import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/core/services/SessionManager.js';
import { SessionStatus } from '../../../src/core/domain/Session.js';
import { ControlAction } from '../../../src/core/domain/Envelope.js';
import { MockCryptoPort } from '../../helpers/MockCryptoPort.js';
import { MockSignalingPort } from '../../helpers/MockSignalingPort.js';
import { MockIdentityPort } from '../../helpers/MockIdentityPort.js';
import { MockStoragePort } from '../../helpers/MockStoragePort.js';
import { MockTransportPort } from '../../helpers/MockTransportPort.js';
import { encodeJson, decodeText, encode, decode } from '../../../src/shared/encoding/base64url.js';
import { WebCryptoEcdhAesGcm } from '../../../src/adapters/crypto/WebCryptoEcdhAesGcm.js';
import { EphemeralIdentityAdapter } from '../../../src/adapters/identity/EphemeralIdentityAdapter.js';

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

  it('persists only public session data by default', async () => {
    const storage = new MockStoragePort();
    const manager = new SessionManager({
      crypto: new MockCryptoPort(),
      signaling: new MockSignalingPort(),
      identity: new MockIdentityPort(),
      storage,
      createTransport: () => new MockTransportPort(),
    });

    const { sessionId, inviteCode } = await manager.createSession('Boundary Test');
    const { answerCode } = await manager.joinSession(inviteCode);
    await manager.finalizeSession(sessionId, answerCode);

    const stored = await storage.load(`session:${sessionId}`);
    expect(stored.privateKeyJwk).toBeUndefined();
    expect(stored.sharedKey).toBeUndefined();
    expect(stored.rootKey).toBeUndefined();
    expect(stored.sendChainKey).toBeUndefined();
    expect(stored.receiveChainKey).toBeUndefined();
    expect(stored.dhRatchetPrivateKeyJwk).toBeUndefined();
    expect(await storage.load(`secret:${sessionId}`)).toBeNull();
  });

  it('enables secret persistence with a passphrase', async () => {
    const storage = new MockStoragePort();
    const manager = new SessionManager({
      crypto: new MockCryptoPort(),
      signaling: new MockSignalingPort(),
      identity: new MockIdentityPort(),
      storage,
      createTransport: () => new MockTransportPort(),
    });

    const { sessionId, inviteCode } = await manager.createSession('Secret Persistence');
    const { answerCode } = await manager.joinSession(inviteCode);
    await manager.finalizeSession(sessionId, answerCode);

    await manager.enableSecretPersistence('correct horse battery staple');

    const secretRecord = await storage.load(`secret:${sessionId}`);
    expect(secretRecord).toMatchObject({
      v: 1,
      iv: expect.any(String),
      data: expect.any(String),
    });
  });

  it('clears persisted data from storage', async () => {
    const storage = new MockStoragePort();
    const manager = new SessionManager({
      crypto: new MockCryptoPort(),
      signaling: new MockSignalingPort(),
      identity: new MockIdentityPort(),
      storage,
      createTransport: () => new MockTransportPort(),
    });

    const { sessionId } = await manager.createSession('Clear Me');
    await manager.clearPersistedData();

    expect(await storage.load('session_ids')).toBeNull();
    expect(await storage.load(`session:${sessionId}`)).toBeNull();
    expect(await storage.load(`messages:${sessionId}`)).toBeNull();
    expect(await storage.load(`secret:${sessionId}`)).toBeNull();
  });

  it('warns when secret persistence is enabled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new SessionManager({
      crypto: new MockCryptoPort(),
      signaling: new MockSignalingPort(),
      identity: new MockIdentityPort(),
      storage: new MockStoragePort(),
      createTransport: () => new MockTransportPort(),
      persistSecrets: true,
      secretPassphrase: 'correct horse battery staple',
    });

    expect(warn).toHaveBeenCalledWith(
      '[SessionManager] Secret persistence is enabled. Session keys are stored on this device and should be protected with the passphrase.',
    );
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

  it('invite code includes signature when crypto supports signing', async () => {
    const { manager } = createManager();
    const { inviteCode } = await manager.createSession('Signed Chat');
    // MockSignalingPort encodes as JSON
    const payload = JSON.parse(inviteCode);
    expect(payload.signature).toBeDefined();
    expect(payload.signingPublicKeyJwk).toBeDefined();
  });

  it('joinSession rejects a tampered invite signature', async () => {
    const badCrypto = new MockCryptoPort();
    badCrypto.verifyPayload = async () => false; // always reject

    const manager2 = new SessionManager({
      crypto: badCrypto,
      signaling: new MockSignalingPort(),
      identity: new MockIdentityPort(),
      storage: new MockStoragePort(),
      createTransport: () => new MockTransportPort(),
    });

    // Encode a tampered invite using MockSignalingPort JSON format
    const tamperedInvite = JSON.stringify({
      type: 'offer',
      sdp: { type: 'offer', sdp: 'v=0' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' },
      sessionId: 'test-session',
      createdAt: Date.now(),
      signingPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'sx', y: 'sy', use: 'sig' },
      signature: 'AAAA',
    });
    await expect(manager2.joinSession(tamperedInvite)).rejects.toThrow(/signature/i);
  });

  it('joinSession rejects an invite where sig is stripped but vk is kept', async () => {
    const { manager } = createManager();
    // Build an invite that has vk but deliberately omits signature
    const strippedInvite = JSON.stringify({
      type: 'offer',
      sdp: { type: 'offer', sdp: 'v=0' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' },
      sessionId: 'test-session-strip',
      createdAt: Date.now(),
      signingPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'sx', y: 'sy', use: 'sig' },
      // deliberately no 'signature' field
    });
    await expect(manager.joinSession(strippedInvite)).rejects.toThrow(/signature/i);
  });

  it('rejects a replayed ciphertext (nonce deduplication)', async () => {
    // A mock whose encrypt/decrypt use a real 12-byte IV prefix (base64url-encoded)
    // so the nonce deduplication logic in _ratchetDecrypt fires on replay.
    class NonceAwareMock extends MockCryptoPort {
      async encrypt(plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const body = new TextEncoder().encode(plaintext);
        const out = new Uint8Array(12 + body.length);
        out.set(iv); out.set(body, 12);
        return encode(out);
      }
      async decrypt(ciphertext) {
        return new TextDecoder().decode(decode(ciphertext).slice(12));
      }
    }

    const transports = [];
    const manager = new SessionManager({
      crypto: new NonceAwareMock(),
      signaling: new MockSignalingPort(),
      identity: new MockIdentityPort(),
      storage: new MockStoragePort(),
      createTransport: () => { const t = new MockTransportPort(); transports.push(t); return t; },
    });

    const { sessionId } = await manager.createSession('Replay Test');
    const answerCode = JSON.stringify({
      type: 'answer',
      sdp: { type: 'answer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'peer_x', y: 'peer_y' },
      sessionId,
    });
    await manager.finalizeSession(sessionId, answerCode);
    transports[0].simulateStateChange('connected');

    // Produce a ciphertext from the peer using the same NonceAwareMock format
    const peerCrypto = new NonceAwareMock();
    const payload = JSON.stringify({ t: 'm', d: { id: 'rep1', text: 'Replay me', from: 'fp', timestamp: Date.now(), counter: 1 } });
    const ciphertext = await peerCrypto.encrypt(payload);

    const received = [];
    manager.on('message', (_id, msg) => received.push(msg));

    // First delivery accepted
    transports[0].simulateMessage(ciphertext);
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(1);
    expect(received[0].text).toBe('Replay me');

    // Exact same ciphertext replayed — silently dropped (nonce already seen)
    transports[0].simulateMessage(ciphertext);
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(1);
  });

  // ── DH Ratchet healing (uses real WebCryptoEcdhAesGcm) ──

  it('DH ratchet: host and guest derive matching directed chains via initDhRatchet', async () => {
    // Use the real DH adapter so initDhRatchet produces non-null results.
    const realCrypto = new WebCryptoEcdhAesGcm();
    const hostTransports = [];
    const guestTransports = [];

    const makeManager = (transportList) => new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => { const t = new MockTransportPort(); transportList.push(t); return t; },
    });

    const hostManager = makeManager(hostTransports);
    const guestManager = makeManager(guestTransports);

    const { sessionId, inviteCode } = await hostManager.createSession('DR Test');
    const { sessionId: guestSid, answerCode } = await guestManager.joinSession(inviteCode);
    await hostManager.finalizeSession(sessionId, answerCode);

    const hostEntry = hostManager.getEntry(sessionId);
    const guestEntry = guestManager.getEntry(guestSid);

    // Both sides must have a root key (DH ratchet was initialised)
    expect(hostEntry.session.rootKey).toBeInstanceOf(Uint8Array);
    expect(guestEntry.session.rootKey).toBeInstanceOf(Uint8Array);

    // Both sides must have their own ratchet keypairs
    expect(hostEntry.session.dhRatchetPublicKeyJwk).toBeDefined();
    expect(guestEntry.session.dhRatchetPublicKeyJwk).toBeDefined();

    // Host knows the guest's initial ratchet key (from the answer)
    expect(hostEntry.session._lastRemoteRatchetPubKeyStr).toBeTruthy();
    // Guest knows the host's initial ratchet key (from the invite)
    expect(guestEntry.session._lastRemoteRatchetPubKeyStr).toBeTruthy();

    // Root keys are identical (derived from the same ECDH material)
    // After guest's initial step, guest's root key is one step ahead of host's
    // initial root; both chains still correctly mirror each other.
    expect(hostEntry.session.sendChainKey).toBeInstanceOf(Uint8Array);
    expect(guestEntry.session.sendChainKey).toBeInstanceOf(Uint8Array);
  });

  it('DH ratchet healing: end-to-end messages with DH step triggering post-compromise chain rotation', async () => {
    const realCrypto = new WebCryptoEcdhAesGcm();

    // ForwardingTransport: routes sent data directly to a peer transport.
    class ForwardingTransport extends MockTransportPort {
      constructor() { super(); this._peer = null; }
      setPeer(peer) { this._peer = peer; }
      send(data) { super.send(data); if (this._peer) this._peer.simulateMessage(data); }
    }

    let hostT, guestT;
    const hostManager = new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => { hostT = new ForwardingTransport(); return hostT; },
    });
    const guestManager = new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => { guestT = new ForwardingTransport(); return guestT; },
    });

    const { sessionId, inviteCode } = await hostManager.createSession(null);
    const { sessionId: guestSid, answerCode } = await guestManager.joinSession(inviteCode);
    await hostManager.finalizeSession(sessionId, answerCode);

    // Cross-wire transports: host.send → guestT.simulateMessage and vice versa
    hostT.setPeer(guestT);
    guestT.setPeer(hostT);

    // Bring both sessions to CONNECTED
    hostT.simulateStateChange('connected');
    guestT.simulateStateChange('connected');

    const hostMsgs = [], guestMsgs = [];
    hostManager.on('message', (_id, m) => hostMsgs.push(m));
    guestManager.on('message', (_id, m) => guestMsgs.push(m));

    // Host sends two messages to guest
    await hostManager.sendMessage(sessionId, 'msg-h1');
    await hostManager.sendMessage(sessionId, 'msg-h2');
    await new Promise((r) => setTimeout(r, 50));
    expect(guestMsgs.map((m) => m.text)).toContain('msg-h1');
    expect(guestMsgs.map((m) => m.text)).toContain('msg-h2');

    // Guest sends a reply — should trigger a DH step on host when received
    // because the guest's first message carries g_pub2 (new since the initiator step)
    // vs the host's stored _lastRemoteRatchetPubKeyStr = JSON.stringify(g_pub1).
    const hostRatchetBefore = hostManager.getEntry(sessionId).session._lastRemoteRatchetPubKeyStr;
    await guestManager.sendMessage(guestSid, 'msg-g1');
    await new Promise((r) => setTimeout(r, 50));
    expect(hostMsgs.map((m) => m.text)).toContain('msg-g1');

    // After receiving guest's message (with new ratchet key from initiator step),
    // host must record the new key — proving the DH healing step fired.
    const hostRatchetAfter = hostManager.getEntry(sessionId).session._lastRemoteRatchetPubKeyStr;
    expect(hostRatchetAfter).not.toBe(hostRatchetBefore);

    // Host can still encrypt and guest can still decrypt after the DH step.
    await hostManager.sendMessage(sessionId, 'msg-h3');
    await new Promise((r) => setTimeout(r, 50));
    expect(guestMsgs.map((m) => m.text)).toContain('msg-h3');
  });

  it('zeroes raw key material when a session is deleted', async () => {
    const { manager } = createManager();
    const { sessionId } = await manager.createSession('Secure Chat');

    const session = manager.getSession(sessionId);
    const sendKey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const recvKey = new Uint8Array([9, 10, 11, 12, 13, 14, 15, 16]);
    const rootKey = new Uint8Array([17, 18, 19, 20, 21, 22, 23, 24]);
    session.sendChainKey = sendKey;
    session.receiveChainKey = recvKey;
    session.rootKey = rootKey;

    await manager.deleteSession(sessionId);

    expect(manager.getSessions().length).toBe(0);
    // Raw Uint8Array key material must be filled with zeros
    expect(Array.from(sendKey)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(recvKey)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(rootKey)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // Key references must be nulled
    expect(session.sendChainKey).toBeNull();
    expect(session.receiveChainKey).toBeNull();
    expect(session.rootKey).toBeNull();
  });

  it('emits a security event when a replay is detected (duplicate nonce)', async () => {
    const { manager, transports } = createManager();
    const { sessionId } = await manager.createSession('Replay Security Test');
    const answerCode = JSON.stringify({
      type: 'answer',
      sdp: { type: 'answer', sdp: 'mock-sdp' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'peer_x', y: 'peer_y' },
      sessionId,
    });
    await manager.finalizeSession(sessionId, answerCode);
    transports[0].simulateStateChange('connected');

    // Build a 16-byte base64url ciphertext: 12-byte nonce prefix + 4-byte payload
    const nonce = new Uint8Array(12).fill(0xab);
    const body = new Uint8Array(4).fill(0xff);
    const ct = new Uint8Array(16);
    ct.set(nonce, 0);
    ct.set(body, 12);
    const ciphertext = encode(ct);
    const nonceKey = encode(nonce);

    // Pre-populate seenNonces to simulate a previously received message
    manager.getEntry(sessionId).seenNonces.add(nonceKey);

    const securityEvents = [];
    manager.on('security', (_id, reason) => securityEvents.push(reason));

    transports[0].simulateMessage(ciphertext);
    await new Promise((r) => setTimeout(r, 10));

    expect(securityEvents).toHaveLength(1);
    expect(securityEvents[0]).toMatch(/Duplicate nonce/i);
  });
});
