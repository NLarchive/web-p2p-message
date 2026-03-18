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
			throw new CryptoError(`Hybrid fingerprint generation failed: ${e.message}`);
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
			const chainAB = new Uint8Array(aBits); // host→guest
			const chainBA = new Uint8Array(bBits); // guest→host
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

	async generateDhRatchetKeyPair() {
		try {
			const kp = await crypto.subtle.generateKey(
				{ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
			);
			const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
			const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
			// Strip key_ops / ext — only kty/crv/x/y needed for public
			return {
				publicKeyJwk: { kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x, y: pubJwk.y },
				privateKeyJwk: privJwk,
			};
		} catch (e) {
			throw new CryptoError(`DH ratchet key generation failed: ${e.message}`);
		}
	}

	async dhRatchetEcdh(myPrivKeyJwk, theirPubKeyJwk) {
		try {
			const priv = await crypto.subtle.importKey(
				'jwk', myPrivKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
			);
			const pub = await crypto.subtle.importKey(
				'jwk', theirPubKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
			);
			const bits = await crypto.subtle.deriveBits(
				{ name: 'ECDH', public: pub }, priv, 256,
			);
			return new Uint8Array(bits);
		} catch (e) {
			throw new CryptoError(`DH ratchet ECDH failed: ${e.message}`);
		}
	}

	async advanceRootChain(rootKeyBytes, dhOutput) {
		try {
			const hkdfKey = await crypto.subtle.importKey('raw', dhOutput, 'HKDF', false, ['deriveBits']);
			const bits = await crypto.subtle.deriveBits(
				{ name: 'HKDF', hash: 'SHA-256', salt: rootKeyBytes, info: new TextEncoder().encode('DR-root-v1') },
				hkdfKey, 512,
			);
			const all = new Uint8Array(bits);
			return { newRootKey: all.slice(0, 32), newChainKey: all.slice(32, 64) };
		} catch (e) {
			throw new CryptoError(`Root chain advancement failed: ${e.message}`);
		}
	}

	async initDhRatchet(sharedKey, myRatchetPrivKeyJwk, remoteRatchetPubKeyJwk, role) {
		try {
			const sharedKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', sharedKey));
			const dhOut = await this.dhRatchetEcdh(myRatchetPrivKeyJwk, remoteRatchetPubKeyJwk);
			const hkdfKey = await crypto.subtle.importKey('raw', dhOut, 'HKDF', false, ['deriveBits']);
			const enc = new TextEncoder();
			const [rootBits, aBits, bBits] = await Promise.all([
				crypto.subtle.deriveBits(
					{ name: 'HKDF', hash: 'SHA-256', salt: sharedKeyBytes, info: enc.encode('DR-init-root') },
					hkdfKey, 256,
				),
				crypto.subtle.deriveBits(
					{ name: 'HKDF', hash: 'SHA-256', salt: sharedKeyBytes, info: enc.encode('chain:host->guest') },
					hkdfKey, 256,
				),
				crypto.subtle.deriveBits(
					{ name: 'HKDF', hash: 'SHA-256', salt: sharedKeyBytes, info: enc.encode('chain:guest->host') },
					hkdfKey, 256,
				),
			]);
			const rootKey = new Uint8Array(rootBits);
			const chainAB = new Uint8Array(aBits); // host→guest
			const chainBA = new Uint8Array(bBits); // guest→host
			return {
				rootKey,
				sendChainKey: role === 'host' ? chainAB : chainBA,
				receiveChainKey: role === 'host' ? chainBA : chainAB,
			};
		} catch (e) {
			throw new CryptoError(`DH ratchet initialisation failed: ${e.message}`);
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
