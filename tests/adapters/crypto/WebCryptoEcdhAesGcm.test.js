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

  it('generates a fingerprint', async () => {
    const kp = await adapter.generateKeyPair();
    const jwk = await adapter.exportPublicKey(kp.publicKey);
    const fp = await adapter.fingerprint(jwk);
    expect(fp).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/);
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
});
