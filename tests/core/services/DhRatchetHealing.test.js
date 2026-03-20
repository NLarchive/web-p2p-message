import { describe, it, expect } from 'vitest';
import { SessionManager } from '../../../src/core/services/SessionManager.js';
import { WebCryptoEcdhAesGcm } from '../../../src/adapters/crypto/WebCryptoEcdhAesGcm.js';
import { EphemeralIdentityAdapter } from '../../../src/adapters/identity/EphemeralIdentityAdapter.js';
import { MockSignalingPort } from '../../helpers/MockSignalingPort.js';
import { MockStoragePort } from '../../helpers/MockStoragePort.js';
import { MockTransportPort } from '../../helpers/MockTransportPort.js';

// ForwardingTransport: routes sent data directly to a peer transport.
class ForwardingTransport extends MockTransportPort {
  constructor() {
    super();
    this._peer = null;
  }
  setPeer(peer) {
    this._peer = peer;
  }
  send(data) {
    super.send(data);
    if (this._peer) this._peer.simulateMessage(data);
  }
}

// Creates a pair of SessionManagers with real WebCrypto and cross-wired transports.
async function setupPair() {
  const realCrypto = new WebCryptoEcdhAesGcm();
  let hostT, guestT;

  const hostManager = new SessionManager({
    crypto: realCrypto,
    signaling: new MockSignalingPort(),
    identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
    storage: new MockStoragePort(),
    createTransport: () => {
      hostT = new ForwardingTransport();
      return hostT;
    },
  });
  const guestManager = new SessionManager({
    crypto: realCrypto,
    signaling: new MockSignalingPort(),
    identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
    storage: new MockStoragePort(),
    createTransport: () => {
      guestT = new ForwardingTransport();
      return guestT;
    },
  });

  const { sessionId, inviteCode } = await hostManager.createSession(null);
  const { sessionId: guestSid, answerCode } = await guestManager.joinSession(inviteCode);
  await hostManager.finalizeSession(sessionId, answerCode);

  hostT.setPeer(guestT);
  guestT.setPeer(hostT);
  hostT.simulateStateChange('connected');
  guestT.simulateStateChange('connected');

  return { hostManager, guestManager, sessionId, guestSid, hostT, guestT, realCrypto };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('DH Ratchet Healing (Double Ratchet post-compromise recovery)', () => {
  // ── 1. DH step produces unique chain keys each time ──
  it('dhRatchetStep derives unique chain keys per step', async () => {
    const adapter = new WebCryptoEcdhAesGcm();

    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const pubB = await adapter.importPublicKey(await adapter.exportPublicKey(kpB.publicKey));
    const sharedKey = await adapter.deriveSharedKey(kpA.privateKey, pubB);

    const rA = await adapter.generateDhRatchetKeyPair();
    const rB = await adapter.generateDhRatchetKeyPair();
    const { rootKey } = await adapter.initDhRatchet(sharedKey, rA.privateKeyJwk, rB.publicKeyJwk, 'host');

    // Step 1: simulate receiving new remote key
    const rB2 = await adapter.generateDhRatchetKeyPair();
    const dh1 = await adapter.dhRatchetEcdh(rA.privateKeyJwk, rB2.publicKeyJwk);
    const { newRootKey: root1, newChainKey: chain1 } = await adapter.advanceRootChain(rootKey, dh1);

    // Step 2: simulate receiving another new remote key
    const rB3 = await adapter.generateDhRatchetKeyPair();
    const rA2 = await adapter.generateDhRatchetKeyPair();
    const dh2 = await adapter.dhRatchetEcdh(rA2.privateKeyJwk, rB3.publicKeyJwk);
    const { newRootKey: root2, newChainKey: chain2 } = await adapter.advanceRootChain(root1, dh2);

    // Each step produces entirely different keys
    expect(root1).not.toEqual(rootKey);
    expect(root2).not.toEqual(root1);
    expect(chain1).not.toEqual(chain2);
    expect(chain1.byteLength).toBe(32);
    expect(chain2.byteLength).toBe(32);
  });

  // ── 2. Post-compromise recovery: old chain key cannot derive new message keys ──
  it('chain keys after DH step are independent of pre-step state', async () => {
    const { hostManager, guestManager, sessionId, guestSid } = await setupPair();

    const hostMsgs = [], guestMsgs = [];
    hostManager.on('message', (_id, m, isSelf) => { if (!isSelf) hostMsgs.push(m); });
    guestManager.on('message', (_id, m, isSelf) => { if (!isSelf) guestMsgs.push(m); });

    // Host sends a message — establishes a "known" send chain state.
    await hostManager.sendMessage(sessionId, 'pre-step');
    await tick();
    expect(guestMsgs.map((m) => m.text)).toContain('pre-step');

    // Capture the host's send chain key BEFORE any DH step happens.
    const hostEntry = hostManager.getEntry(sessionId);
    const preStepSendChain = Uint8Array.from(hostEntry.session.sendChainKey);
    const preStepRootKey = Uint8Array.from(hostEntry.session.rootKey);

    // Guest replies — triggers DH step on host side (new remote ratchet key).
    await guestManager.sendMessage(guestSid, 'trigger-step');
    await tick();
    expect(hostMsgs.map((m) => m.text)).toContain('trigger-step');

    // After DH step, host has new chain keys derived from fresh DH output.
    const postStepSendChain = hostEntry.session.sendChainKey;
    const postStepRootKey = hostEntry.session.rootKey;

    // Chain keys and root key MUST differ (new DH output mixed in).
    expect(postStepSendChain).not.toEqual(preStepSendChain);
    expect(postStepRootKey).not.toEqual(preStepRootKey);

    // An attacker who captured preStepSendChain cannot derive postStepSendChain
    // because the DH output (from a new ephemeral key pair) is mixed into the
    // root chain. Verify by advancing the OLD chain and showing it doesn't match.
    const adapter = new WebCryptoEcdhAesGcm();
    const { nextChainKey: attackerChain } = await adapter.advanceChain(preStepSendChain);
    expect(attackerChain).not.toEqual(postStepSendChain);

    // Post-step messages still work for the legitimate peer.
    await hostManager.sendMessage(sessionId, 'post-step-secret');
    await tick();
    expect(guestMsgs.map((m) => m.text)).toContain('post-step-secret');
  });

  // ── 3. Out-of-order messages decrypt correctly via skipped-key store ──
  // Tests at the _ratchetDecrypt level to isolate the ratchet skip logic from
  // the application-layer counter validation (which rightfully rejects reorder).
  it('skipped message keys enable out-of-order decryption', async () => {
    const realCrypto = new WebCryptoEcdhAesGcm();
    let hostT, guestT;

    const hostManager = new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => {
        hostT = new ForwardingTransport();
        return hostT;
      },
    });
    const guestManager = new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => {
        guestT = new ForwardingTransport();
        return guestT;
      },
    });

    const { sessionId, inviteCode } = await hostManager.createSession(null);
    const { sessionId: guestSid, answerCode } = await guestManager.joinSession(inviteCode);
    await hostManager.finalizeSession(sessionId, answerCode);

    // Do NOT cross-wire — we'll manually deliver messages out of order.
    hostT.simulateStateChange('connected');
    guestT.simulateStateChange('connected');

    // Host sends 3 messages sequentially (captured by hostT.sent).
    await hostManager.sendMessage(sessionId, 'msg-0');
    await hostManager.sendMessage(sessionId, 'msg-1');
    await hostManager.sendMessage(sessionId, 'msg-2');

    // Filter only v:2 ratchet envelopes (skip title sync control messages).
    const ratchetEnvelopes = hostT.sent.filter((s) => {
      try { const p = JSON.parse(s); return p.v === 2; } catch { return false; }
    });
    expect(ratchetEnvelopes.length).toBe(3);

    // Call _ratchetDecrypt directly to test the skipped-key logic
    // without going through the message counter layer.
    const guestEntry = guestManager.getEntry(guestSid);

    // Deliver msg-2 FIRST (n=2 skips indices 0 and 1)
    const plain2 = await guestManager._ratchetDecrypt(guestEntry, ratchetEnvelopes[2]);
    expect(plain2).toContain('msg-2');
    expect(guestEntry.session.receiveChainIndex).toBe(3); // advanced past 0,1,2
    expect(guestEntry.session.skippedMessageKeys.size).toBe(2); // keys for n=0 and n=1

    // Deliver msg-0 (out-of-order → skipped-key lookup)
    const plain0 = await guestManager._ratchetDecrypt(guestEntry, ratchetEnvelopes[0]);
    expect(plain0).toContain('msg-0');
    expect(guestEntry.session.skippedMessageKeys.size).toBe(1); // key for n=1 remains

    // Deliver msg-1 (out-of-order → skipped-key lookup)
    const plain1 = await guestManager._ratchetDecrypt(guestEntry, ratchetEnvelopes[1]);
    expect(plain1).toContain('msg-1');
    expect(guestEntry.session.skippedMessageKeys.size).toBe(0); // all consumed
  });

  // ── 4. MAX_SKIP enforced — throws if gap too large ──
  it('throws on gap exceeding MAX_SKIP', async () => {
    const realCrypto = new WebCryptoEcdhAesGcm();
    let hostT, guestT;

    const hostManager = new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => {
        hostT = new ForwardingTransport();
        return hostT;
      },
    });
    const guestManager = new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => {
        guestT = new ForwardingTransport();
        return guestT;
      },
    });

    const { sessionId, inviteCode } = await hostManager.createSession(null);
    const { sessionId: guestSid, answerCode } = await guestManager.joinSession(inviteCode);
    await hostManager.finalizeSession(sessionId, answerCode);

    hostT.simulateStateChange('connected');
    guestT.simulateStateChange('connected');

    // Build a forged envelope with n=150 (>MAX_SKIP=100 gap from index 0).
    // We need a valid v:2 envelope that will pass JSON parsing.
    const hostEntry = hostManager.getEntry(sessionId);
    const forgedEnvelope = JSON.stringify({
      v: 2,
      pk: JSON.stringify(hostEntry.session.dhRatchetPublicKeyJwk),
      n: 150, // gap of 150 from guest's receiveChainIndex (0)
      c: 'AAAA', // dummy ciphertext — will fail after gap check
    });

    // Guest should reject due to MAX_SKIP violation (silently caught in transport handler).
    // To test the error directly, call _ratchetDecrypt on the guest's entry.
    const guestEntry = guestManager.getEntry(guestSid);
    await expect(
      guestManager._ratchetDecrypt(guestEntry, forgedEnvelope),
    ).rejects.toThrow(/Too many skipped/);
  });

  // ── 5. Bidirectional ratchet with multiple DH steps ──
  it('bidirectional ratchet maintains correct chain separation across multiple DH steps', async () => {
    const { hostManager, guestManager, sessionId, guestSid } = await setupPair();

    const hostMsgs = [], guestMsgs = [];
    hostManager.on('message', (_id, m, isSelf) => { if (!isSelf) hostMsgs.push(m); });
    guestManager.on('message', (_id, m, isSelf) => { if (!isSelf) guestMsgs.push(m); });

    // Round 1: Host → Guest (no DH step yet on guest side)
    await hostManager.sendMessage(sessionId, 'h→g round 1');
    await tick();
    expect(guestMsgs.map((m) => m.text)).toContain('h→g round 1');

    // Round 2: Guest → Host (triggers DH step on host)
    await guestManager.sendMessage(guestSid, 'g→h round 2');
    await tick();
    expect(hostMsgs.map((m) => m.text)).toContain('g→h round 2');

    // Round 3: Host → Guest (triggers DH step on guest — host's key rotated in round 2)
    await hostManager.sendMessage(sessionId, 'h→g round 3');
    await tick();
    expect(guestMsgs.map((m) => m.text)).toContain('h→g round 3');

    // Round 4: Guest → Host (another DH step on host)
    await guestManager.sendMessage(guestSid, 'g→h round 4');
    await tick();
    expect(hostMsgs.map((m) => m.text)).toContain('g→h round 4');

    // Round 5: Host → Guest again
    await hostManager.sendMessage(sessionId, 'h→g round 5');
    await tick();
    expect(guestMsgs.map((m) => m.text)).toContain('h→g round 5');

    // 3 host→guest messages received by guest, 2 guest→host messages received by host.
    expect(guestMsgs).toHaveLength(3);
    expect(hostMsgs).toHaveLength(2);
  });

  // ── 6. Full conversation: many messages, both directions, multiple DH steps ──
  it('full double ratchet conversation with multiple DH steps', async () => {
    const { hostManager, guestManager, sessionId, guestSid } = await setupPair();

    const hostMsgs = [], guestMsgs = [];
    hostManager.on('message', (_id, m, isSelf) => { if (!isSelf) hostMsgs.push(m); });
    guestManager.on('message', (_id, m, isSelf) => { if (!isSelf) guestMsgs.push(m); });

    // Capture DH step indicators: root key changes on host after guest messages.
    const hostRootKeys = [];
    const guestRootKeys = [];

    // Phase 1: Host sends 3 messages in a burst
    for (let i = 0; i < 3; i++) {
      await hostManager.sendMessage(sessionId, `burst-h-${i}`);
    }
    await tick();
    expect(guestMsgs).toHaveLength(3);
    hostRootKeys.push(Uint8Array.from(hostManager.getEntry(sessionId).session.rootKey));

    // Phase 2: Guest sends 2 messages → triggers DH step on host
    for (let i = 0; i < 2; i++) {
      await guestManager.sendMessage(guestSid, `burst-g-${i}`);
    }
    await tick();
    expect(hostMsgs).toHaveLength(2);
    hostRootKeys.push(Uint8Array.from(hostManager.getEntry(sessionId).session.rootKey));

    // Phase 3: Host sends 2 more → triggers DH step on guest
    for (let i = 0; i < 2; i++) {
      await hostManager.sendMessage(sessionId, `burst2-h-${i}`);
    }
    await tick();
    expect(guestMsgs).toHaveLength(5); // 3 + 2
    guestRootKeys.push(Uint8Array.from(guestManager.getEntry(guestSid).session.rootKey));

    // Phase 4: Guest sends 1 more → another DH step on host
    await guestManager.sendMessage(guestSid, 'final-g');
    await tick();
    expect(hostMsgs).toHaveLength(3);
    hostRootKeys.push(Uint8Array.from(hostManager.getEntry(sessionId).session.rootKey));

    // Root keys advanced after each direction change
    expect(hostRootKeys[0]).not.toEqual(hostRootKeys[1]);
    expect(hostRootKeys[1]).not.toEqual(hostRootKeys[2]);

    // All messages correctly decrypted
    const guestTexts = guestMsgs.map((m) => m.text);
    expect(guestTexts).toContain('burst-h-0');
    expect(guestTexts).toContain('burst-h-1');
    expect(guestTexts).toContain('burst-h-2');
    expect(guestTexts).toContain('burst2-h-0');
    expect(guestTexts).toContain('burst2-h-1');

    const hostTexts = hostMsgs.map((m) => m.text);
    expect(hostTexts).toContain('burst-g-0');
    expect(hostTexts).toContain('burst-g-1');
    expect(hostTexts).toContain('final-g');
  });

  // ── 7. Attacker with compromised chain key cannot decrypt post-step messages ──
  it('compromised chain key is useless after DH ratchet step', async () => {
    const realCrypto = new WebCryptoEcdhAesGcm();
    let hostT, guestT;

    const hostManager = new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => {
        hostT = new ForwardingTransport();
        return hostT;
      },
    });
    const guestManager = new SessionManager({
      crypto: realCrypto,
      signaling: new MockSignalingPort(),
      identity: new EphemeralIdentityAdapter({ crypto: realCrypto }),
      storage: new MockStoragePort(),
      createTransport: () => {
        guestT = new ForwardingTransport();
        return guestT;
      },
    });

    const { sessionId, inviteCode } = await hostManager.createSession(null);
    const { sessionId: guestSid, answerCode } = await guestManager.joinSession(inviteCode);
    await hostManager.finalizeSession(sessionId, answerCode);
    hostT.setPeer(guestT);
    guestT.setPeer(hostT);
    hostT.simulateStateChange('connected');
    guestT.simulateStateChange('connected');

    const guestMsgs = [];
    guestManager.on('message', (_id, m) => guestMsgs.push(m));

    // Host sends pre-compromise message
    await hostManager.sendMessage(sessionId, 'before-compromise');
    await tick();
    expect(guestMsgs).toHaveLength(1);

    // ATTACKER CAPTURES the host's current send chain key
    const compromisedChainKey = Uint8Array.from(
      hostManager.getEntry(sessionId).session.sendChainKey,
    );

    // Guest replies — triggers DH step on host side
    await guestManager.sendMessage(guestSid, 'healing-trigger');
    await tick();

    // Host sends post-compromise message
    await hostManager.sendMessage(sessionId, 'after-healing');
    await tick();
    expect(guestMsgs).toHaveLength(3); // before, healing-trigger via cross-wire, after

    // Attacker tries to derive the message key from the compromised chain
    const { messageKey: attackerKey } = await realCrypto.advanceChain(compromisedChainKey);

    // Capture the last v:2 envelope sent by host
    const ratchetEnvelopes = hostT.sent.filter((s) => {
      try { const p = JSON.parse(s); return p.v === 2; } catch { return false; }
    });
    const lastEnvelope = JSON.parse(ratchetEnvelopes[ratchetEnvelopes.length - 1]);

    // Attacker tries to decrypt with compromised-derived key — must fail
    await expect(
      realCrypto.decrypt(lastEnvelope.c, attackerKey),
    ).rejects.toThrow();
  });

  // ── 8. Envelope header contains ratchet pub key, index, and version ──
  it('v:2 envelope carries ratchetPubKey and chain index', async () => {
    const { hostManager, sessionId, hostT } = await setupPair();

    // Title sync messages may be sent on connect; send 2 real messages
    await hostManager.sendMessage(sessionId, 'envelope-test-1');
    await hostManager.sendMessage(sessionId, 'envelope-test-2');

    const ratchetEnvelopes = hostT.sent.filter((s) => {
      try { const p = JSON.parse(s); return p.v === 2; } catch { return false; }
    });
    expect(ratchetEnvelopes.length).toBeGreaterThanOrEqual(2);

    const env1 = JSON.parse(ratchetEnvelopes[ratchetEnvelopes.length - 2]);
    const env2 = JSON.parse(ratchetEnvelopes[ratchetEnvelopes.length - 1]);

    expect(env1.v).toBe(2);
    expect(typeof env1.pk).toBe('string');
    expect(typeof env1.n).toBe('number');
    expect(typeof env1.c).toBe('string');

    // Same ratchet pub key within a single send chain
    expect(env1.pk).toBe(env2.pk);
    // Sequential chain indices
    expect(env2.n).toBe(env1.n + 1);
  });
});
