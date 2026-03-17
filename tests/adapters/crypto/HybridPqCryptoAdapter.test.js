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
});