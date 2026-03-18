import { describe, it, expect } from 'vitest';
import { HybridPqCryptoAdapter } from '../../../src/adapters/crypto/HybridPqCryptoAdapter.js';

describe('HybridPqCryptoAdapter', () => {
  const adapter = new HybridPqCryptoAdapter();

  it('encapsulates and decapsulates the same shared key', async () => {
    const host = await adapter.generateKeyPair();
    const guest = await adapter.encapsulateSharedKey(host.publicKey);
    const hostShared = await adapter.decapsulateSharedKey(
      host.privateKey,
      guest.cipherText,
    );

    const ciphertext = await adapter.encrypt('pq secret', guest.sharedKey);
    expect(await adapter.decrypt(ciphertext, hostShared)).toBe('pq secret');
  });

  it('exports and restores persisted material', async () => {
    const host = await adapter.generateKeyPair();
    const exportedPrivate = await adapter.exportPrivateKey(host.privateKey);
    const exportedPublic = await adapter.exportPublicKey(host.publicKey);
    const importedPrivate = await adapter.importPrivateKey(exportedPrivate);
    const importedPublic = await adapter.importPublicKey(exportedPublic);

    const guest = await adapter.encapsulateSharedKey(importedPublic);
    const hostShared = await adapter.decapsulateSharedKey(
      importedPrivate,
      guest.cipherText,
    );
    const persistedShared = await adapter.importSharedKey(
      await adapter.exportSharedKey(hostShared),
    );

    const ciphertext = await adapter.encrypt('restored', guest.sharedKey);
    expect(await adapter.decrypt(ciphertext, persistedShared)).toBe('restored');
  });

  it('generates stable fingerprints for the exported public key', async () => {
    const keyPair = await adapter.generateKeyPair();
    const exported = await adapter.exportPublicKey(keyPair.publicKey);
    const fingerprint = await adapter.fingerprint(exported);
    expect(fingerprint).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/);
  });

  it('combines two keys into a different fingerprint', async () => {
    const kp = await adapter.generateKeyPair();
    const exported = await adapter.exportPublicKey(kp.publicKey);
    const sigKp = await adapter.generateSigningKeyPair();
    const sigJwk = await adapter.exportSigningPublicKey(sigKp.publicKey);
    const single = await adapter.fingerprint(exported);
    const combined = await adapter.fingerprint(exported, sigJwk);
    expect(combined).not.toBe(single);
    expect(combined).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/);
  });

  it('signing key pair signs and verifies a payload', async () => {
    const sigKp = await adapter.generateSigningKeyPair();
    const sigPubJwk = await adapter.exportSigningPublicKey(sigKp.publicKey);
    const bytes = new TextEncoder().encode('pq canonical payload');
    const sig = await adapter.signPayload(bytes, sigKp.privateKey);
    expect(await adapter.verifyPayload(bytes, sig, sigPubJwk)).toBe(true);
    const tampered = new TextEncoder().encode('pq tampered payload');
    expect(await adapter.verifyPayload(tampered, sig, sigPubJwk)).toBe(false);
  });

  it('derives matching ratchet chains from the same shared key', async () => {
    const host = await adapter.generateKeyPair();
    const { sharedKey: guestShared, cipherText } = await adapter.encapsulateSharedKey(host.publicKey);
    const hostShared = await adapter.decapsulateSharedKey(host.privateKey, cipherText);

    const hostChains = await adapter.deriveRatchetKeys(hostShared, 'host');
    const guestChains = await adapter.deriveRatchetKeys(guestShared, 'guest');

    expect(hostChains.sendChainKey).toEqual(guestChains.receiveChainKey);
    expect(hostChains.receiveChainKey).toEqual(guestChains.sendChainKey);
  });

  it('full ratchet round-trip: 3 messages with key advancing', async () => {
    const host = await adapter.generateKeyPair();
    const { sharedKey: guestShared, cipherText } = await adapter.encapsulateSharedKey(host.publicKey);
    const hostShared = await adapter.decapsulateSharedKey(host.privateKey, cipherText);

    const hostChains = await adapter.deriveRatchetKeys(hostShared, 'host');
    const guestChains = await adapter.deriveRatchetKeys(guestShared, 'guest');

    let sendChain = hostChains.sendChainKey;
    let recvChain = guestChains.receiveChainKey;

    const messages = ['first', 'second', 'third'];
    for (const msg of messages) {
      const { messageKey: sKey, nextChainKey: nextSend } = await adapter.advanceChain(sendChain);
      const { messageKey: rKey, nextChainKey: nextRecv } = await adapter.advanceChain(recvChain);
      const ct = await adapter.encrypt(msg, sKey);
      expect(await adapter.decrypt(ct, rKey)).toBe(msg);
      sendChain = nextSend;
      recvChain = nextRecv;
    }
  });

  // ── DH Ratchet (Double Ratchet healing layer) ──

  it('generateDhRatchetKeyPair returns exportable P-256 JWK pair', async () => {
    const kp = await adapter.generateDhRatchetKeyPair();
    expect(kp.publicKeyJwk.kty).toBe('EC');
    expect(kp.publicKeyJwk.crv).toBe('P-256');
    expect(kp.publicKeyJwk.x).toBeDefined();
    expect(kp.publicKeyJwk.y).toBeDefined();
    expect(kp.publicKeyJwk.d).toBeUndefined();
    expect(kp.privateKeyJwk.d).toBeDefined();
  });

  it('dhRatchetEcdh is symmetric', async () => {
    const kpA = await adapter.generateDhRatchetKeyPair();
    const kpB = await adapter.generateDhRatchetKeyPair();
    const outAB = await adapter.dhRatchetEcdh(kpA.privateKeyJwk, kpB.publicKeyJwk);
    const outBA = await adapter.dhRatchetEcdh(kpB.privateKeyJwk, kpA.publicKeyJwk);
    expect(outAB).toBeInstanceOf(Uint8Array);
    expect(outAB.byteLength).toBe(32);
    expect(outAB).toEqual(outBA);
  });

  it('initDhRatchet derives matching directed chains for host and guest', async () => {
    const host = await adapter.generateKeyPair();
    const { sharedKey: guestShared, cipherText } = await adapter.encapsulateSharedKey(host.publicKey);
    const hostShared = await adapter.decapsulateSharedKey(host.privateKey, cipherText);

    const ratchetH = await adapter.generateDhRatchetKeyPair();
    const ratchetG = await adapter.generateDhRatchetKeyPair();

    const hostChains = await adapter.initDhRatchet(hostShared, ratchetH.privateKeyJwk, ratchetG.publicKeyJwk, 'host');
    const guestChains = await adapter.initDhRatchet(guestShared, ratchetG.privateKeyJwk, ratchetH.publicKeyJwk, 'guest');

    // Directed chains are mirrored between host and guest
    expect(hostChains.sendChainKey).toEqual(guestChains.receiveChainKey);
    expect(hostChains.receiveChainKey).toEqual(guestChains.sendChainKey);
    expect(hostChains.rootKey).toEqual(guestChains.rootKey);
  });

  it('DH ratchet step yields new root and chain keys', async () => {
    const host = await adapter.generateKeyPair();
    const { sharedKey: guestShared, cipherText } = await adapter.encapsulateSharedKey(host.publicKey);
    const hostShared = await adapter.decapsulateSharedKey(host.privateKey, cipherText);

    const ratchetH = await adapter.generateDhRatchetKeyPair();
    const ratchetG = await adapter.generateDhRatchetKeyPair();
    const { rootKey } = await adapter.initDhRatchet(hostShared, ratchetH.privateKeyJwk, ratchetG.publicKeyJwk, 'host');

    // Simulate receiver seeing a new ratchet key (Double Ratchet "step")
    const ratchetG2 = await adapter.generateDhRatchetKeyPair();
    const dh1 = await adapter.dhRatchetEcdh(ratchetH.privateKeyJwk, ratchetG2.publicKeyJwk);
    const { newRootKey: root2, newChainKey: recvChain } = await adapter.advanceRootChain(rootKey, dh1);
    const ratchetH2 = await adapter.generateDhRatchetKeyPair();
    const dh2 = await adapter.dhRatchetEcdh(ratchetH2.privateKeyJwk, ratchetG2.publicKeyJwk);
    const { newRootKey: root3, newChainKey: sendChain } = await adapter.advanceRootChain(root2, dh2);

    expect(root2).not.toEqual(rootKey);
    expect(root3).not.toEqual(root2);
    expect(sendChain).not.toEqual(recvChain);
  });
});