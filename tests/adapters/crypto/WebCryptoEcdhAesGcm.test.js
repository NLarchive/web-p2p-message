import { describe, it, expect } from 'vitest';
import { WebCryptoEcdhAesGcm } from '../../../src/adapters/crypto/WebCryptoEcdhAesGcm.js';

describe('WebCryptoEcdhAesGcm', () => {
  const adapter = new WebCryptoEcdhAesGcm();

  it('generates a key pair', async () => {
    const kp = await adapter.generateKeyPair();
    expect(kp.publicKey).toBeDefined();
    expect(kp.privateKey).toBeDefined();
  });

  it('exports and imports a public key', async () => {
    const kp = await adapter.generateKeyPair();
    const jwk = await adapter.exportPublicKey(kp.publicKey);
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    const imported = await adapter.importPublicKey(jwk);
    expect(imported).toBeDefined();
  });

  it('derives the same shared key from both sides', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const jwkA = await adapter.exportPublicKey(kpA.publicKey);
    const jwkB = await adapter.exportPublicKey(kpB.publicKey);
    const pubA = await adapter.importPublicKey(jwkA);
    const pubB = await adapter.importPublicKey(jwkB);

    const sharedAB = await adapter.deriveSharedKey(kpA.privateKey, pubB);
    const sharedBA = await adapter.deriveSharedKey(kpB.privateKey, pubA);

    // Encrypt with one, decrypt with the other
    const plaintext = 'Hello, crypto!';
    const ciphertext = await adapter.encrypt(plaintext, sharedAB);
    const decrypted = await adapter.decrypt(ciphertext, sharedBA);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypts and decrypts a message', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const pubB = await adapter.importPublicKey(
      await adapter.exportPublicKey(kpB.publicKey),
    );
    const shared = await adapter.deriveSharedKey(kpA.privateKey, pubB);

    const plaintext = 'Test message with special chars: 🔒✅';
    const ct = await adapter.encrypt(plaintext, shared);
    expect(ct).not.toContain(plaintext);

    const pubA = await adapter.importPublicKey(
      await adapter.exportPublicKey(kpA.publicKey),
    );
    const shared2 = await adapter.deriveSharedKey(kpB.privateKey, pubA);
    expect(await adapter.decrypt(ct, shared2)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const pubB = await adapter.importPublicKey(
      await adapter.exportPublicKey(kpB.publicKey),
    );
    const shared = await adapter.deriveSharedKey(kpA.privateKey, pubB);

    const ct1 = await adapter.encrypt('same', shared);
    const ct2 = await adapter.encrypt('same', shared);
    expect(ct1).not.toBe(ct2);
  });

  it('fails to decrypt with wrong key', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const kpC = await adapter.generateKeyPair();
    const pubB = await adapter.importPublicKey(
      await adapter.exportPublicKey(kpB.publicKey),
    );
    const pubC = await adapter.importPublicKey(
      await adapter.exportPublicKey(kpC.publicKey),
    );
    const sharedAB = await adapter.deriveSharedKey(kpA.privateKey, pubB);
    const sharedAC = await adapter.deriveSharedKey(kpA.privateKey, pubC);

    const ct = await adapter.encrypt('secret', sharedAB);
    await expect(adapter.decrypt(ct, sharedAC)).rejects.toThrow();
  });

  it('exports and restores private and shared keys', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();

    const exportedPrivate = await adapter.exportPrivateKey(kpA.privateKey);
    const restoredPrivate = await adapter.importPrivateKey(exportedPrivate);
    const restoredPublic = await adapter.importPublicKey(
      await adapter.exportPublicKey(kpB.publicKey),
    );

    const shared = await adapter.deriveSharedKey(restoredPrivate, restoredPublic);
    const exportedShared = await adapter.exportSharedKey(shared);
    const restoredShared = await adapter.importSharedKey(exportedShared);

    const ciphertext = await adapter.encrypt('persisted secret', restoredShared);
    const originalPeerShared = await adapter.deriveSharedKey(
      kpB.privateKey,
      await adapter.importPublicKey(await adapter.exportPublicKey(kpA.publicKey)),
    );
    expect(await adapter.decrypt(ciphertext, originalPeerShared)).toBe('persisted secret');
  });

  it('generates a fingerprint', async () => {
    const kp = await adapter.generateKeyPair();
    const jwk = await adapter.exportPublicKey(kp.publicKey);
    const fp = await adapter.fingerprint(jwk);
    expect(fp).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/);
  });

  it('combines two keys into one fingerprint', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const jwkA = await adapter.exportPublicKey(kpA.publicKey);
    const jwkB = await adapter.exportPublicKey(kpB.publicKey);
    const single = await adapter.fingerprint(jwkA);
    const combined = await adapter.fingerprint(jwkA, jwkB);
    expect(combined).not.toBe(single);
    expect(combined).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/);
  });

  it('signing key pair signs and verifies a payload', async () => {
    const sigKp = await adapter.generateSigningKeyPair();
    const sigPubJwk = await adapter.exportSigningPublicKey(sigKp.publicKey);
    const bytes = new TextEncoder().encode('canonical payload bytes');
    const sig = await adapter.signPayload(bytes, sigKp.privateKey);
    const valid = await adapter.verifyPayload(bytes, sig, sigPubJwk);
    expect(valid).toBe(true);
  });

  it('verifyPayload rejects tampered bytes', async () => {
    const sigKp = await adapter.generateSigningKeyPair();
    const sigPubJwk = await adapter.exportSigningPublicKey(sigKp.publicKey);
    const bytes = new TextEncoder().encode('original');
    const sig = await adapter.signPayload(bytes, sigKp.privateKey);
    const tampered = new TextEncoder().encode('tampered');
    const valid = await adapter.verifyPayload(tampered, sig, sigPubJwk);
    expect(valid).toBe(false);
  });

  it('derives symmetric ratchet chains from a shared key', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const pubB = await adapter.importPublicKey(await adapter.exportPublicKey(kpB.publicKey));
    const sharedKey = await adapter.deriveSharedKey(kpA.privateKey, pubB);

    const host = await adapter.deriveRatchetKeys(sharedKey, 'host');
    const guest = await adapter.deriveRatchetKeys(sharedKey, 'guest');

    expect(host.sendChainKey).toBeInstanceOf(Uint8Array);
    expect(host.receiveChainKey).toBeInstanceOf(Uint8Array);
    // host send chain == guest receive chain (and vice versa)
    expect(host.sendChainKey).toEqual(guest.receiveChainKey);
    expect(host.receiveChainKey).toEqual(guest.sendChainKey);
  });

  it('advanceChain produces a message key and advances state', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const pubB = await adapter.importPublicKey(await adapter.exportPublicKey(kpB.publicKey));
    const sharedKey = await adapter.deriveSharedKey(kpA.privateKey, pubB);
    const { sendChainKey } = await adapter.deriveRatchetKeys(sharedKey, 'host');

    const step1 = await adapter.advanceChain(sendChainKey);
    const step2 = await adapter.advanceChain(step1.nextChainKey);

    expect(step1.messageKey).toBeDefined();
    expect(step2.messageKey).toBeDefined();
    // Different chain steps produce different message keys
    const enc1 = await adapter.encrypt('msg', step1.messageKey);
    await expect(adapter.decrypt(enc1, step2.messageKey)).rejects.toThrow();
  });

  it('ratchet encrypt/decrypt round-trip: host sends, guest receives', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const pubA = await adapter.importPublicKey(await adapter.exportPublicKey(kpA.publicKey));
    const pubB = await adapter.importPublicKey(await adapter.exportPublicKey(kpB.publicKey));
    const sharedAB = await adapter.deriveSharedKey(kpA.privateKey, pubB);
    const sharedBA = await adapter.deriveSharedKey(kpB.privateKey, pubA);

    const hostChains = await adapter.deriveRatchetKeys(sharedAB, 'host');
    const guestChains = await adapter.deriveRatchetKeys(sharedBA, 'guest');

    // Host sends msg1
    const { messageKey: mkey1, nextChainKey: nextSend1 } = await adapter.advanceChain(hostChains.sendChainKey);
    const ct1 = await adapter.encrypt('hello', mkey1);

    // Guest receives msg1
    const { messageKey: rmkey1 } = await adapter.advanceChain(guestChains.receiveChainKey);
    expect(await adapter.decrypt(ct1, rmkey1)).toBe('hello');

    // Host sends msg2 with advanced chain
    const { messageKey: mkey2 } = await adapter.advanceChain(nextSend1);
    const ct2 = await adapter.encrypt('world', mkey2);

    // Guest receives msg2
    const { messageKey: rmkey2 } = await adapter.advanceChain(
      (await adapter.advanceChain(guestChains.receiveChainKey)).nextChainKey
    );
    expect(await adapter.decrypt(ct2, rmkey2)).toBe('world');
  });

  it('produces different fingerprints for different keys', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const fpA = await adapter.fingerprint(
      await adapter.exportPublicKey(kpA.publicKey),
    );
    const fpB = await adapter.fingerprint(
      await adapter.exportPublicKey(kpB.publicKey),
    );
    expect(fpA).not.toBe(fpB);
  });

  // ── DH Ratchet (Double Ratchet healing layer) ──

  it('generateDhRatchetKeyPair returns exportable P-256 JWK pair', async () => {
    const kp = await adapter.generateDhRatchetKeyPair();
    expect(kp.publicKeyJwk.kty).toBe('EC');
    expect(kp.publicKeyJwk.crv).toBe('P-256');
    expect(kp.publicKeyJwk.x).toBeDefined();
    expect(kp.publicKeyJwk.y).toBeDefined();
    // Public JWK must NOT contain the private scalar
    expect(kp.publicKeyJwk.d).toBeUndefined();
    // Private JWK must contain the scalar
    expect(kp.privateKeyJwk.d).toBeDefined();
  });

  it('dhRatchetEcdh is symmetric (both sides compute the same secret)', async () => {
    const kpA = await adapter.generateDhRatchetKeyPair();
    const kpB = await adapter.generateDhRatchetKeyPair();
    const outAB = await adapter.dhRatchetEcdh(kpA.privateKeyJwk, kpB.publicKeyJwk);
    const outBA = await adapter.dhRatchetEcdh(kpB.privateKeyJwk, kpA.publicKeyJwk);
    expect(outAB).toBeInstanceOf(Uint8Array);
    expect(outAB.byteLength).toBe(32);
    expect(outAB).toEqual(outBA);
  });

  it('advanceRootChain produces 32-byte root and chain keys', async () => {
    const root = crypto.getRandomValues(new Uint8Array(32));
    const dhOut = crypto.getRandomValues(new Uint8Array(32));
    const result = await adapter.advanceRootChain(root, dhOut);
    expect(result.newRootKey).toBeInstanceOf(Uint8Array);
    expect(result.newRootKey.byteLength).toBe(32);
    expect(result.newChainKey).toBeInstanceOf(Uint8Array);
    expect(result.newChainKey.byteLength).toBe(32);
    // Different DH outputs → different chain keys
    const dhOut2 = crypto.getRandomValues(new Uint8Array(32));
    const result2 = await adapter.advanceRootChain(root, dhOut2);
    expect(result2.newRootKey).not.toEqual(result.newRootKey);
    expect(result2.newChainKey).not.toEqual(result.newChainKey);
  });

  it('initDhRatchet derives matching directed chains for host and guest', async () => {
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const pubA = await adapter.importPublicKey(await adapter.exportPublicKey(kpA.publicKey));
    const pubB = await adapter.importPublicKey(await adapter.exportPublicKey(kpB.publicKey));
    const sharedAB = await adapter.deriveSharedKey(kpA.privateKey, pubB);
    const sharedBA = await adapter.deriveSharedKey(kpB.privateKey, pubA);

    // Each side generates its own ratchet key pair
    const ratchetH = await adapter.generateDhRatchetKeyPair();
    const ratchetG = await adapter.generateDhRatchetKeyPair();

    // Both sides call initDhRatchet; ECDH is symmetric so they derive the same material
    const hostChains = await adapter.initDhRatchet(sharedAB, ratchetH.privateKeyJwk, ratchetG.publicKeyJwk, 'host');
    const guestChains = await adapter.initDhRatchet(sharedBA, ratchetG.privateKeyJwk, ratchetH.publicKeyJwk, 'guest');

    expect(hostChains.rootKey).toBeInstanceOf(Uint8Array);
    // Directed chains must be opposite for host and guest
    expect(hostChains.sendChainKey).toEqual(guestChains.receiveChainKey);
    expect(hostChains.receiveChainKey).toEqual(guestChains.sendChainKey);
    // Root keys are identical (both derived the same root)
    expect(hostChains.rootKey).toEqual(guestChains.rootKey);
  });

  it('DH ratchet step provides post-compromise security (new chains after step)', async () => {
    // Build an initial shared state
    const kpA = await adapter.generateKeyPair();
    const kpB = await adapter.generateKeyPair();
    const pubA = await adapter.importPublicKey(await adapter.exportPublicKey(kpA.publicKey));
    const pubB = await adapter.importPublicKey(await adapter.exportPublicKey(kpB.publicKey));
    const sharedAB = await adapter.deriveSharedKey(kpA.privateKey, pubB);
    const sharedBA = await adapter.deriveSharedKey(kpB.privateKey, pubA);

    const ratchetA = await adapter.generateDhRatchetKeyPair();
    const ratchetB = await adapter.generateDhRatchetKeyPair();
    const { rootKey } = await adapter.initDhRatchet(sharedAB, ratchetA.privateKeyJwk, ratchetB.publicKeyJwk, 'host');

    // Simulate a DH ratchet step: A receives a NEW ratchet key from B
    const ratchetB2 = await adapter.generateDhRatchetKeyPair();
    const dhOut1 = await adapter.dhRatchetEcdh(ratchetA.privateKeyJwk, ratchetB2.publicKeyJwk);
    const { newRootKey: root2, newChainKey: recvChain } = await adapter.advanceRootChain(rootKey, dhOut1);

    // A generates a new local key pair and advances root chain again for sending
    const ratchetA2 = await adapter.generateDhRatchetKeyPair();
    const dhOut2 = await adapter.dhRatchetEcdh(ratchetA2.privateKeyJwk, ratchetB2.publicKeyJwk);
    const { newRootKey: root3, newChainKey: sendChain } = await adapter.advanceRootChain(root2, dhOut2);

    // All three roots and chains must be different (each step advances state)
    expect(root2).not.toEqual(rootKey);
    expect(root3).not.toEqual(root2);
    expect(sendChain).not.toEqual(recvChain);

    // The recv chain is usable for decryption: B can derive the matching send chain
    // B does the corresponding step: ECDH(ratchetB2.priv, ratchetA2.pub) → same output as A's dhOut2
    const dhOutB = await adapter.dhRatchetEcdh(ratchetB2.privateKeyJwk, ratchetA2.publicKeyJwk);
    const { newChainKey: bSendChain } = await adapter.advanceRootChain(root2, dhOutB);
    expect(bSendChain).toEqual(sendChain); // A's send chain == B's derived recv chain
  });
});
