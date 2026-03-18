import { ICryptoPort } from '../../core/ports/ICryptoPort.js';
import { CryptoError } from '../../shared/errors/AppErrors.js';
import { encode, decode } from '../../shared/encoding/base64url.js';

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const AES_PARAMS = { name: 'AES-GCM', length: 256 };
const IV_BYTES = 12;
const FINGERPRINT_BYTES = 8;

export class WebCryptoEcdhAesGcm extends ICryptoPort {
  get handshakeMode() {
    return 'dh';
  }

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

  async exportPrivateKey(privateKey) {
    try {
      return await crypto.subtle.exportKey('jwk', privateKey);
    } catch (e) {
      throw new CryptoError(`Private key export failed: ${e.message}`);
    }
  }

  async importPrivateKey(jwk) {
    try {
      return await crypto.subtle.importKey(
        'jwk',
        jwk,
        ECDH_PARAMS,
        true,
        ['deriveKey'],
      );
    } catch (e) {
      throw new CryptoError(`Private key import failed: ${e.message}`);
    }
  }

  async deriveSharedKey(privateKey, remotePublicKey) {
    try {
      return await crypto.subtle.deriveKey(
        { name: 'ECDH', public: remotePublicKey },
        privateKey,
        AES_PARAMS,
        true,
        ['encrypt', 'decrypt'],
      );
    } catch (e) {
      throw new CryptoError(`Key derivation failed: ${e.message}`);
    }
  }

  async exportSharedKey(sharedKey) {
    try {
      return encode(await crypto.subtle.exportKey('raw', sharedKey));
    } catch (e) {
      throw new CryptoError(`Shared key export failed: ${e.message}`);
    }
  }

  async importSharedKey(serialized) {
    try {
      return await crypto.subtle.importKey(
        'raw',
        decode(serialized),
        AES_PARAMS,
        true,
        ['encrypt', 'decrypt'],
      );
    } catch (e) {
      throw new CryptoError(`Shared key import failed: ${e.message}`);
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

  async fingerprint(primaryKeyJwk, secondaryKeyJwk = null) {
    try {
      const input = secondaryKeyJwk
        ? `${JSON.stringify(primaryKeyJwk)}|${JSON.stringify(secondaryKeyJwk)}`
        : JSON.stringify(primaryKeyJwk);
      const raw = new TextEncoder().encode(input);
      const hash = await crypto.subtle.digest('SHA-256', raw);
      return Array.from(new Uint8Array(hash).slice(0, FINGERPRINT_BYTES))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(':');
    } catch (e) {
      throw new CryptoError(`Fingerprint generation failed: ${e.message}`);
    }
  }

  async generateSigningKeyPair() {
    try {
      return await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign', 'verify'],
      );
    } catch (e) {
      throw new CryptoError(`Signing key generation failed: ${e.message}`);
    }
  }

  async exportSigningPublicKey(publicKey) {
    try {
      return await crypto.subtle.exportKey('jwk', publicKey);
    } catch (e) {
      throw new CryptoError(`Signing public key export failed: ${e.message}`);
    }
  }

  async signPayload(bytes, privateKey) {
    try {
      const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        bytes,
      );
      return new Uint8Array(sig);
    } catch (e) {
      throw new CryptoError(`Payload signing failed: ${e.message}`);
    }
  }

  async verifyPayload(bytes, signature, publicKeyJwk) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      return await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        signature,
        bytes,
      );
    } catch (e) {
      throw new CryptoError(`Payload verification failed: ${e.message}`);
    }
  }

  async deriveRatchetKeys(sharedKey, role) {
    try {
      const rootBytes = await crypto.subtle.exportKey('raw', sharedKey);
      const hkdfKey = await crypto.subtle.importKey('raw', rootBytes, 'HKDF', false, ['deriveBits']);
      const enc = new TextEncoder();
      const [aBits, bBits] = await Promise.all([
        crypto.subtle.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('chain:host->guest') },
          hkdfKey, 256,
        ),
        crypto.subtle.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('chain:guest->host') },
          hkdfKey, 256,
        ),
      ]);
      const chainAB = new Uint8Array(aBits);
      const chainBA = new Uint8Array(bBits);
      return role === 'host'
        ? { sendChainKey: chainAB, receiveChainKey: chainBA }
        : { sendChainKey: chainBA, receiveChainKey: chainAB };
    } catch (e) {
      throw new CryptoError(`Ratchet key derivation failed: ${e.message}`);
    }
  }

  async advanceChain(chainKeyBytes) {
    try {
      const hmacKey = await crypto.subtle.importKey(
        'raw', chainKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const [msgKeyBuf, nextKeyBuf] = await Promise.all([
        crypto.subtle.sign('HMAC', hmacKey, Uint8Array.from([0x01])),
        crypto.subtle.sign('HMAC', hmacKey, Uint8Array.from([0x02])),
      ]);
      const messageKey = await crypto.subtle.importKey(
        'raw', new Uint8Array(msgKeyBuf), AES_PARAMS, false, ['encrypt', 'decrypt'],
      );
      return { messageKey, nextChainKey: new Uint8Array(nextKeyBuf) };
    } catch (e) {
      throw new CryptoError(`Chain advancement failed: ${e.message}`);
    }
  }
}
