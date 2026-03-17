import { ICryptoPort } from '../../core/ports/ICryptoPort.js';
import { CryptoError } from '../../shared/errors/AppErrors.js';
import { encode, decode } from '../../shared/encoding/base64url.js';
import { XWing } from '@noble/post-quantum/hybrid.js';

const AES_PARAMS = { name: 'AES-GCM', length: 256 };
const IV_BYTES = 12;
const FINGERPRINT_BYTES = 8;

export class HybridPqCryptoAdapter extends ICryptoPort {
	get handshakeMode() {
		return 'kem';
	}

	async generateKeyPair() {
		try {
			const { publicKey, secretKey } = XWing.keygen();
			return {
				publicKey: Uint8Array.from(publicKey),
				privateKey: Uint8Array.from(secretKey),
			};
		} catch (e) {
			throw new CryptoError(`Hybrid key generation failed: ${e.message}`);
		}
	}

	async exportPublicKey(publicKey) {
		return {
			kty: 'PQKEM',
			alg: 'XWing',
			key: encode(publicKey),
		};
	}

	async importPublicKey(serialized) {
		try {
			if (serialized?.alg !== 'XWing' || typeof serialized?.key !== 'string') {
				throw new Error('Unsupported public key format');
			}
			return decode(serialized.key);
		} catch (e) {
			throw new CryptoError(`Hybrid public key import failed: ${e.message}`);
		}
	}

	async exportPrivateKey(privateKey) {
		return {
			kty: 'PQKEM',
			alg: 'XWing',
			seed: encode(privateKey),
		};
	}

	async importPrivateKey(serialized) {
		try {
			if (serialized?.alg !== 'XWing' || typeof serialized?.seed !== 'string') {
				throw new Error('Unsupported private key format');
			}
			return decode(serialized.seed);
		} catch (e) {
			throw new CryptoError(`Hybrid private key import failed: ${e.message}`);
		}
	}

	async deriveSharedKey() {
		throw new CryptoError('deriveSharedKey is not available for the hybrid KEM suite');
	}

	async encapsulateSharedKey(remotePublicKey) {
		try {
			const { sharedSecret, cipherText } = XWing.encapsulate(remotePublicKey);
			const sharedKey = await this._importAesKey(sharedSecret);
			sharedSecret.fill(0);
			return {
				sharedKey,
				cipherText: encode(cipherText),
			};
		} catch (e) {
			throw new CryptoError(`Hybrid encapsulation failed: ${e.message}`);
		}
	}

	async decapsulateSharedKey(privateKey, cipherText) {
		try {
			const sharedSecret = XWing.decapsulate(decode(cipherText), privateKey);
			const sharedKey = await this._importAesKey(sharedSecret);
			sharedSecret.fill(0);
			return sharedKey;
		} catch (e) {
			throw new CryptoError(`Hybrid decapsulation failed: ${e.message}`);
		}
	}

	async exportSharedKey(sharedKey) {
		try {
			return encode(await crypto.subtle.exportKey('raw', sharedKey));
		} catch (e) {
			throw new CryptoError(`Hybrid shared key export failed: ${e.message}`);
		}
	}

	async importSharedKey(serialized) {
		try {
			return await this._importAesKey(decode(serialized));
		} catch (e) {
			throw new CryptoError(`Hybrid shared key import failed: ${e.message}`);
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
			throw new CryptoError(`Hybrid encryption failed: ${e.message}`);
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
			throw new CryptoError(`Hybrid decryption failed: ${e.message}`);
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
			throw new CryptoError(`Hybrid fingerprint generation failed: ${e.message}`);
		}
	}

	async _importAesKey(rawKey) {
		return crypto.subtle.importKey(
			'raw',
			rawKey,
			AES_PARAMS,
			true,
			['encrypt', 'decrypt'],
		);
	}
}
