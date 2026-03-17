import { ICryptoPort } from '../../core/ports/ICryptoPort.js';
import { CryptoError } from '../../shared/errors/AppErrors.js';
import { encode, decode } from '../../shared/encoding/base64url.js';

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const AES_PARAMS = { name: 'AES-GCM', length: 256 };
const IV_BYTES = 12;
const FINGERPRINT_BYTES = 8;

export class WebCryptoEcdhAesGcm extends ICryptoPort {
  async generateKeyPair() {
    try {
      return await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey']);
    } catch (e) {
      throw new CryptoError(`Key generation failed: ${e.message}`);
    }
  }

  async exportPublicKey(publicKey) {
    try {
      return await crypto.subtle.exportKey('jwk', publicKey);
    } catch (e) {
      throw new CryptoError(`Public key export failed: ${e.message}`);
    }
  }

  async importPublicKey(jwk) {
    try {
      return await crypto.subtle.importKey('jwk', jwk, ECDH_PARAMS, true, []);
    } catch (e) {
      throw new CryptoError(`Public key import failed: ${e.message}`);
    }
  }

  async deriveSharedKey(privateKey, remotePublicKey) {
    try {
      return await crypto.subtle.deriveKey(
        { name: 'ECDH', public: remotePublicKey },
        privateKey,
        AES_PARAMS,
        false,
        ['encrypt', 'decrypt'],
      );
    } catch (e) {
      throw new CryptoError(`Key derivation failed: ${e.message}`);
    }
  }

  async encrypt(plaintext, sharedKey) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const encoded = new TextEncoder().encode(plaintext);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        sharedKey,
        encoded,
      );
      const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(ciphertext), IV_BYTES);
      return encode(combined);
    } catch (e) {
      throw new CryptoError(`Encryption failed: ${e.message}`);
    }
  }

  async decrypt(ciphertextB64, sharedKey) {
    try {
      const combined = decode(ciphertextB64);
      if (combined.length < IV_BYTES + 1) {
        throw new Error('Ciphertext too short');
      }
      const iv = combined.slice(0, IV_BYTES);
      const ciphertext = combined.slice(IV_BYTES);
      const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        sharedKey,
        ciphertext,
      );
      return new TextDecoder().decode(plainBuffer);
    } catch (e) {
      throw new CryptoError(`Decryption failed: ${e.message}`);
    }
  }

  async fingerprint(publicKeyJwk) {
    try {
      const raw = new TextEncoder().encode(JSON.stringify(publicKeyJwk));
      const hash = await crypto.subtle.digest('SHA-256', raw);
      return Array.from(new Uint8Array(hash).slice(0, FINGERPRINT_BYTES))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(':');
    } catch (e) {
      throw new CryptoError(`Fingerprint generation failed: ${e.message}`);
    }
  }
}
