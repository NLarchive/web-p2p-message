import { Session, SessionStatus } from '../domain/Session.js';
import { PeerIdentity } from '../domain/PeerIdentity.js';
import { Message } from '../domain/Message.js';
import {
  wrapChatMessage,
  wrapControl,
  unwrap,
  ControlAction,
} from '../domain/Envelope.js';
import { encode, decode, encodeJson, decodeJson } from '../../shared/encoding/base64url.js';
import { inviteCanonicalBytes } from '../../adapters/signaling/ManualCodeSignalingAdapter.js';
import { InvalidInviteError } from '../../shared/errors/AppErrors.js';

const STORAGE_INDEX_KEY = 'session_ids';
const sessionStorageKey = (id) => `session:${id}`;
const secretStorageKey = (id) => `secret:${id}`;
const messagesStorageKey = (id) => `messages:${id}`;
const SECRET_WRAP_SALT_KEY = 'secret_wrap_salt';

export class SessionManager {
  constructor({ crypto, signaling, identity, storage, createTransport, persistSecrets = false, secretPassphrase = null }) {
    this._crypto = crypto;
    this._signaling = signaling;
    this._identity = identity;
    this._storage = storage;
    this._createTransport = createTransport;
    this._iceConfig = {}; // forwarded to createTransport as extra opts
    this._persistSecrets = persistSecrets && typeof secretPassphrase === 'string' && secretPassphrase.length > 0;
    this._secretPassphrase = this._persistSecrets ? secretPassphrase : null;
    this._secretWrapKeyPromise = null;

    if (persistSecrets && !this._persistSecrets) {
      console.warn('[SessionManager] Secret persistence is disabled unless a passphrase is provided.');
    } else if (this._persistSecrets) {
      console.warn('[SessionManager] Secret persistence is enabled. Session keys are stored on this device and should be protected with the passphrase.');
    }

    // Map<sessionId, { session, transport, keyPair, privateKeyJwk, messages, pendingSignal }>
    this._entries = new Map();
    this._listeners = {};
  }

  /** Set ICE override options (iceServers, iceTransportPolicy) for future transports. */
  setIceConfig(config) {
    this._iceConfig = config;
  }

  isSecretPersistenceEnabled() {
    return this._persistSecrets;
  }

  async enableSecretPersistence(secretPassphrase) {
    if (typeof secretPassphrase !== 'string' || secretPassphrase.trim().length < 16) {
      throw new Error('Passphrase must be at least 16 characters');
    }
    this._persistSecrets = true;
    this._secretPassphrase = secretPassphrase.trim();
    this._secretWrapKeyPromise = null;
    for (const sessionId of this._entries.keys()) {
      await this._persistSession(sessionId);
    }
  }

  async clearPersistedData() {
    this._persistSecrets = false;
    this._secretPassphrase = null;
    this._secretWrapKeyPromise = null;
    await this._storage.clear();
  }

  // ── Events ──

  on(event, callback) {
    (this._listeners[event] ??= []).push(callback);
  }

  off(event, callback) {
    const cbs = this._listeners[event];
    if (cbs) this._listeners[event] = cbs.filter((cb) => cb !== callback);
  }

  _emit(event, ...args) {
    for (const cb of this._listeners[event] ?? []) cb(...args);
  }

  // ── Persistence ──

  async loadSessions() {
    const ids = (await this._storage.load(STORAGE_INDEX_KEY)) ?? [];
    for (const id of ids) {
      const data = await this._storage.load(sessionStorageKey(id));
      if (!data) continue;
      const { session } = Session.fromSerializable(data);
      let secretData = null;
      if (this._persistSecrets) {
        try {
          secretData = await this._decryptSecretState(await this._storage.load(secretStorageKey(id)));
        } catch {
          secretData = null;
        }
      }

      if (secretData?.sharedKey && this._crypto.importSharedKey) {
        try {
          session.sharedKey = await this._crypto.importSharedKey(secretData.sharedKey);
        } catch {
          // Can't restore shared key; reconnect flow will regenerate it.
        }
      }

      // Re-derive sharedKey if we have the wrapped crypto material
      if (
        !session.sharedKey &&
        this._persistSecrets &&
        this._crypto.handshakeMode === 'dh' &&
        secretData?.privateKeyJwk &&
        session.remoteIdentity
      ) {
        try {
          if (this._crypto.importPrivateKey && this._crypto.deriveSharedKey) {
            const privateKey = await this._crypto.importPrivateKey(secretData.privateKeyJwk);
            const remotePublicKey = await this._crypto.importPublicKey(
              session.remoteIdentity.publicKeyJwk,
            );
            session.sharedKey = await this._crypto.deriveSharedKey(
              privateKey,
              remotePublicKey,
            );
          }
        } catch {
          // Can't restore crypto — session remains without sharedKey
        }
      }

      if (secretData) {
        if (secretData.sendChainKey) session.sendChainKey = decode(secretData.sendChainKey);
        if (secretData.receiveChainKey) session.receiveChainKey = decode(secretData.receiveChainKey);
        if (secretData.rootKey) session.rootKey = decode(secretData.rootKey);
        if (secretData.dhRatchetPrivateKeyJwk) session.dhRatchetPrivateKeyJwk = secretData.dhRatchetPrivateKeyJwk;
      }

      const messages = (await this._storage.load(messagesStorageKey(id))) ?? [];
      this._entries.set(id, {
        session,
        transport: null,
        keyPair: null,
        privateKeyJwk: secretData?.privateKeyJwk ?? null,
        messages,
        seenNonces: new Set(),
        pendingSignal: data.pendingSignal ?? null,
      });
    }
  }

  async _persistSession(id) {
    const entry = this._entries.get(id);
    if (!entry) return;

    let privateKeyJwk = entry.privateKeyJwk;
    if (!privateKeyJwk && entry.keyPair) {
      try {
        privateKeyJwk = this._crypto.exportPrivateKey
          ? await this._crypto.exportPrivateKey(entry.keyPair.privateKey)
          : await crypto.subtle.exportKey('jwk', entry.keyPair.privateKey);
      } catch {
        // Non-exportable key
      }
    }

    await this._storage.save(
      sessionStorageKey(id),
      {
        ...entry.session.toSerializable(),
        pendingSignal: entry.pendingSignal ?? null,
      },
    );

    if (this._persistSecrets) {
      const secretState = await this._buildSecretState(entry, privateKeyJwk);
      if (secretState) {
        await this._storage.save(secretStorageKey(id), await this._encryptSecretState(secretState));
      } else {
        await this._storage.remove(secretStorageKey(id));
      }
    } else {
      await this._storage.remove(secretStorageKey(id));
    }

    await this._storage.save(messagesStorageKey(id), entry.messages);

    // Update index
    const ids = [...this._entries.keys()];
    await this._storage.save(STORAGE_INDEX_KEY, ids);
  }

  async _removePersistedSession(id) {
    await this._storage.remove(sessionStorageKey(id));
    await this._storage.remove(secretStorageKey(id));
    await this._storage.remove(messagesStorageKey(id));
    const ids = [...this._entries.keys()].filter((k) => k !== id);
    await this._storage.save(STORAGE_INDEX_KEY, ids);
  }

  async _getSecretWrapKey() {
    if (!this._persistSecrets) return null;
    if (!this._secretWrapKeyPromise) {
      this._secretWrapKeyPromise = (async () => {
        const encoder = new TextEncoder();
        let salt = await this._storage.load(SECRET_WRAP_SALT_KEY);
        if (typeof salt === 'string') {
          salt = decode(salt);
        }
        if (!(salt instanceof Uint8Array) || salt.length === 0) {
          salt = crypto.getRandomValues(new Uint8Array(16));
          await this._storage.save(SECRET_WRAP_SALT_KEY, encode(salt));
        }
        const passphraseKey = await crypto.subtle.importKey(
          'raw',
          encoder.encode(this._secretPassphrase),
          'PBKDF2',
          false,
          ['deriveKey'],
        );
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
          passphraseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        );
      })();
    }
    return this._secretWrapKeyPromise;
  }

  async _buildSecretState(entry, privateKeyJwk) {
    const secretState = {
      privateKeyJwk: privateKeyJwk ?? null,
      sendChainKey: entry.session.sendChainKey ? encode(entry.session.sendChainKey) : null,
      receiveChainKey: entry.session.receiveChainKey ? encode(entry.session.receiveChainKey) : null,
      rootKey: entry.session.rootKey ? encode(entry.session.rootKey) : null,
      sharedKey: null,
      dhRatchetPrivateKeyJwk: entry.session.dhRatchetPrivateKeyJwk ?? null,
    };

    if (entry.session.sharedKey && this._crypto.exportSharedKey) {
      try {
        secretState.sharedKey = await this._crypto.exportSharedKey(entry.session.sharedKey);
      } catch {
        secretState.sharedKey = null;
      }
    }

    if (
      !secretState.privateKeyJwk &&
      !secretState.sharedKey &&
      !secretState.sendChainKey &&
      !secretState.receiveChainKey &&
      !secretState.rootKey &&
      !secretState.dhRatchetPrivateKeyJwk
    ) {
      return null;
    }

    return secretState;
  }

  async _encryptSecretState(secretState) {
    const wrapKey = await this._getSecretWrapKey();
    if (!wrapKey) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(secretState));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, plaintext);
    return {
      v: 1,
      iv: encode(iv),
      data: encode(new Uint8Array(ciphertext)),
    };
  }

  async _decryptSecretState(record) {
    if (!record || typeof record !== 'object' || record.v !== 1) return null;
    const wrapKey = await this._getSecretWrapKey();
    if (!wrapKey) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(record.iv) },
      wrapKey,
      decode(record.data),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  // ── Session Lifecycle ──

  async createSession(title) {
    const sessionId = crypto.randomUUID();
    const transport = this._createTransport(sessionId, this._iceConfig);
    const localId = await this._identity.createIdentity();
    const session = new Session({ id: sessionId, role: 'host' });
    session.title = title || null;
    session.localIdentity = new PeerIdentity({
      publicKeyJwk: localId.publicKeyJwk,
      fingerprint: localId.fingerprint,
    });

    const offerSdp = await transport.createOffer();

    // Generate an ECDSA P-256 signing key to authenticate the invite payload.
    // The combined fingerprint (KEM key + signing key) is what the user compares
    // out-of-band — forging the signature requires the signing private key.
    let signingPublicKeyJwk = null;
    let signature = null;
    let dhRatchetPublicKeyJwk = null;
    let dhRatchetPrivateKeyJwk = null;

    if (this._crypto.generateSigningKeyPair) {
      try {
        const signingKeyPair = await this._crypto.generateSigningKeyPair();
        signingPublicKeyJwk = await this._crypto.exportSigningPublicKey(signingKeyPair.publicKey);

        // Generate the host's initial DH ratchet key pair alongside the signing key.
        if (this._crypto.generateDhRatchetKeyPair) {
          const drKp = await this._crypto.generateDhRatchetKeyPair();
          dhRatchetPublicKeyJwk = drKp.publicKeyJwk;
          dhRatchetPrivateKeyJwk = drKp.privateKeyJwk;
        }

        // Signature covers all invite fields including the ratchet public key.
        const canonical = inviteCanonicalBytes({
          sdp: offerSdp,
          publicKeyJwk: localId.publicKeyJwk,
          sessionId,
          createdAt: session.createdAt,
          signingPublicKeyJwk,
          dhRatchetPublicKeyJwk,
        });
        const sigBytes = await this._crypto.signPayload(canonical, signingKeyPair.privateKey);
        signature = encode(sigBytes);
      } catch {
        signingPublicKeyJwk = null;
        signature = null;
        dhRatchetPublicKeyJwk = null;
        dhRatchetPrivateKeyJwk = null;
      }
    }

    // Extend local fingerprint to cover both KEM key and signing key.
    if (signingPublicKeyJwk) {
      const combinedFp = await this._crypto.fingerprint(localId.publicKeyJwk, signingPublicKeyJwk);
      session.localIdentity.fingerprint = combinedFp;
    }

    // Store host's ratchet keypair in session so it's ready when the guest's
    // ratchet public key arrives in the answer (finalizeSession).
    if (dhRatchetPublicKeyJwk) {
      session.dhRatchetPublicKeyJwk = dhRatchetPublicKeyJwk;
      session.dhRatchetPrivateKeyJwk = dhRatchetPrivateKeyJwk;
    }

    const inviteCode = this._signaling.encodeOffer({
      sdp: offerSdp,
      publicKeyJwk: localId.publicKeyJwk,
      sessionId,
      createdAt: session.createdAt,
      signingPublicKeyJwk,
      signature,
      dhRatchetPublicKeyJwk,
    });

    session.transition(SessionStatus.AWAITING_ANSWER);

    const privateKeyJwk = this._crypto.exportPrivateKey
      ? await this._crypto.exportPrivateKey(localId.keyPair.privateKey)
      : await crypto.subtle.exportKey('jwk', localId.keyPair.privateKey);

    const entry = {
      session,
      transport,
      keyPair: localId.keyPair,
      privateKeyJwk,
      messages: [],
      seenNonces: new Set(),
      pendingSignal: {
        type: 'invite',
        code: inviteCode,
      },
    };
    this._entries.set(sessionId, entry);
    await this._persistSession(sessionId);
    this._emit('update', sessionId);

    return { sessionId, inviteCode };
  }

  async joinSession(inviteCode) {
    const offer = this._signaling.decodeOffer(inviteCode);

    // Verify invite signature when present — prevents MITM timestamp revival.
    // If a signing key (vk) is declared but the signature is absent the attacker
    // may have stripped it to downgrade verification; reject immediately.
    if (offer.signingPublicKeyJwk && this._crypto.verifyPayload) {
      if (!offer.signature) {
        throw new InvalidInviteError('Invite carries a signing key but no signature — possible signature-stripping attack');
      }
      const canonical = inviteCanonicalBytes({
        sdp: offer.sdp,
        publicKeyJwk: offer.publicKeyJwk,
        sessionId: offer.sessionId,
        createdAt: offer.createdAt,
        signingPublicKeyJwk: offer.signingPublicKeyJwk,
        dhRatchetPublicKeyJwk: offer.dhRatchetPublicKeyJwk ?? null,
      });
      const sigBytes = decode(offer.signature);
      const valid = await this._crypto.verifyPayload(canonical, sigBytes, offer.signingPublicKeyJwk);
      if (!valid) {
        throw new InvalidInviteError('Invite signature is invalid — payload may have been tampered');
      }
    }

    const transport = this._createTransport(offer.sessionId, this._iceConfig);
    const localId = await this._identity.createIdentity();

    const session = new Session({
      id: offer.sessionId,
      role: 'guest',
      createdAt: offer.createdAt,
    });
    session.title = null; // Title syncs from host after connection
    session.localIdentity = new PeerIdentity({
      publicKeyJwk: localId.publicKeyJwk,
      fingerprint: localId.fingerprint,
    });

    const remotePublicKey = await this._crypto.importPublicKey(
      offer.publicKeyJwk,
    );
    // Extend remote fingerprint to cover the signing key when invite was signed.
    const remoteFingerprint = await this._crypto.fingerprint(
      offer.publicKeyJwk,
      offer.signingPublicKeyJwk ?? null,
    );
    session.remoteIdentity = new PeerIdentity({
      publicKeyJwk: offer.publicKeyJwk,
      fingerprint: remoteFingerprint,
    });

    let sharedKey;
    let cipherText = null;
    if (this._crypto.handshakeMode === 'kem') {
      const encapsulated = await this._crypto.encapsulateSharedKey(remotePublicKey);
      sharedKey = encapsulated.sharedKey;
      cipherText = encapsulated.cipherText;
    } else {
      sharedKey = await this._crypto.deriveSharedKey(
        localId.keyPair.privateKey,
        remotePublicKey,
      );
    }
    session.sharedKey = sharedKey;

    // Initialise per-direction ratchet chains from the shared session key.
    // If both sides exchanged DH ratchet public keys, use the full DH-based
    // init (provides root key for future healing steps); otherwise fall back
    // to the symmetric HMAC chain derivation.
    const guestRatchetPub = offer.dhRatchetPublicKeyJwk ?? null;
    const guestRatchetPriv = null; // guest's own ratchet private key is set below
    let guestDrKp = null;
    if (guestRatchetPub === null && this._crypto.deriveRatchetKeys) {
      // No ratchet key in offer — symmetric-only path
      const chains = await this._crypto.deriveRatchetKeys(sharedKey, 'guest');
      if (chains) { session.sendChainKey = chains.sendChainKey; session.receiveChainKey = chains.receiveChainKey; }
    } else if (guestRatchetPub && this._crypto.initDhRatchet) {
      // Guest generates its own ratchet key pair BEFORE initDhRatchet.
      guestDrKp = await this._crypto.generateDhRatchetKeyPair();
      const chains = await this._crypto.initDhRatchet(sharedKey, guestDrKp.privateKeyJwk, offer.dhRatchetPublicKeyJwk, 'guest');
      if (chains) {
        session.rootKey = chains.rootKey;
        session.sendChainKey = chains.sendChainKey;
        session.receiveChainKey = chains.receiveChainKey;
        session.dhRatchetPublicKeyJwk = guestDrKp.publicKeyJwk;
        session.dhRatchetPrivateKeyJwk = guestDrKp.privateKeyJwk;
        // Last seen remote ratchet key is the host's initial key from the invite.
        session._lastRemoteRatchetPubKeyStr = JSON.stringify(offer.dhRatchetPublicKeyJwk);

        // Initiator's first DH ratchet step (Signal-protocol "Alice sends first").
        // Generate a new ephemeral key pair and advance the root chain once more.
        // The new public key (advertised in message headers) is DIFFERENT from
        // guestDrKp.publicKeyJwk (which stays in the answer for initDhRatchet).
        // When host receives a message with the new key it triggers its own DH step
        // — starting the self-healing forward-secrecy loop.
        if (this._crypto.advanceRootChain) {
          const newGuestKp = await this._crypto.generateDhRatchetKeyPair();
          const dhOut2 = await this._crypto.dhRatchetEcdh(
            newGuestKp.privateKeyJwk, offer.dhRatchetPublicKeyJwk,
          );
          const { newRootKey: root2, newChainKey: sendChain2 } =
            await this._crypto.advanceRootChain(session.rootKey, dhOut2);
          session.rootKey = root2;
          session.sendChainKey = sendChain2;
          session.sendChainIndex = 0;
          // receiveChainKey is intentionally kept as chains.receiveChainKey
          session.dhRatchetPublicKeyJwk = newGuestKp.publicKeyJwk;
          session.dhRatchetPrivateKeyJwk = newGuestKp.privateKeyJwk;
          // guestDrKp (for encodeAnswer) is intentionally NOT changed here:
          // the answer carries the original g_pub1 so the host can run initDhRatchet.
        }
      } else {
        // initDhRatchet returned null (mock adapter) — fall back to symmetric chain derivation.
        guestDrKp = null;
        if (this._crypto.deriveRatchetKeys) {
          const symChains = await this._crypto.deriveRatchetKeys(sharedKey, 'guest');
          if (symChains) { session.sendChainKey = symChains.sendChainKey; session.receiveChainKey = symChains.receiveChainKey; }
        }
      }
    }

    const answerSdp = await transport.acceptOffer(offer.sdp);
    const answerCode = this._signaling.encodeAnswer({
      sdp: answerSdp,
      publicKeyJwk: localId.publicKeyJwk,
      sessionId: offer.sessionId,
      cipherText,
      dhRatchetPublicKeyJwk: guestDrKp ? guestDrKp.publicKeyJwk : null,
    });

    session.transition(SessionStatus.AWAITING_FINALIZE);

    const privateKeyJwk = this._crypto.exportPrivateKey
      ? await this._crypto.exportPrivateKey(localId.keyPair.privateKey)
      : await crypto.subtle.exportKey('jwk', localId.keyPair.privateKey);

    const entry = {
      session,
      transport,
      keyPair: localId.keyPair,
      privateKeyJwk,
      messages: [],
      seenNonces: new Set(),
      pendingSignal: {
        type: 'answer',
        code: answerCode,
      },
    };
    this._entries.set(offer.sessionId, entry);
    this._setupTransportListeners(offer.sessionId);
    await this._persistSession(offer.sessionId);
    this._emit('update', offer.sessionId);

    return { sessionId: offer.sessionId, answerCode };
  }

  async finalizeSession(sessionId, answerCode) {
    const entry = this._entries.get(sessionId);
    if (!entry) throw new Error('Session not found');

    const answer = this._signaling.decodeAnswer(answerCode);
    if (answer.sessionId !== sessionId) {
      throw new Error('Answer session ID does not match');
    }

    const remotePublicKey = await this._crypto.importPublicKey(
      answer.publicKeyJwk,
    );
    const remoteFingerprint = await this._crypto.fingerprint(
      answer.publicKeyJwk,
    );
    // Track fingerprint changes for UI warning
    if (entry.session.remoteIdentity?.fingerprint) {
      entry.session._previousRemoteFingerprint = entry.session.remoteIdentity.fingerprint;
      if (entry.session.remoteIdentity.fingerprint !== remoteFingerprint) {
        entry.session.fingerprintVerified = false; // reset on change
      }
    }
    entry.session.remoteIdentity = new PeerIdentity({
      publicKeyJwk: answer.publicKeyJwk,
      fingerprint: remoteFingerprint,
    });

    const sharedKey = this._crypto.handshakeMode === 'kem' && answer.cipherText
      ? await this._crypto.decapsulateSharedKey(
          entry.keyPair.privateKey,
          answer.cipherText,
        )
      : await this._crypto.deriveSharedKey(
          entry.keyPair.privateKey,
          remotePublicKey,
        );
    entry.session.sharedKey = sharedKey;

    // Initialise ratchet chains for the host from the shared session key.
    const hostRatchetPub = answer.dhRatchetPublicKeyJwk ?? null;
    if (!hostRatchetPub && this._crypto.deriveRatchetKeys) {
      // No guest ratchet key in answer — symmetric-only path
      const chains = await this._crypto.deriveRatchetKeys(sharedKey, 'host');
      if (chains) { entry.session.sendChainKey = chains.sendChainKey; entry.session.receiveChainKey = chains.receiveChainKey; }
    } else if (hostRatchetPub && this._crypto.initDhRatchet && entry.session.dhRatchetPrivateKeyJwk) {
      // Host has its ratchet private key (stored in session) and now has guest's public key.
      const chains = await this._crypto.initDhRatchet(
        sharedKey, entry.session.dhRatchetPrivateKeyJwk, answer.dhRatchetPublicKeyJwk, 'host',
      );
      if (chains) {
        entry.session.rootKey = chains.rootKey;
        entry.session.sendChainKey = chains.sendChainKey;
        entry.session.receiveChainKey = chains.receiveChainKey;
        // Last seen remote ratchet key is the guest's initial key from the answer.
        entry.session._lastRemoteRatchetPubKeyStr = JSON.stringify(answer.dhRatchetPublicKeyJwk);
      } else if (this._crypto.deriveRatchetKeys) {
        // initDhRatchet returned null (mock adapter) — fall back to symmetric chain derivation.
        const symChains = await this._crypto.deriveRatchetKeys(sharedKey, 'host');
        if (symChains) { entry.session.sendChainKey = symChains.sendChainKey; entry.session.receiveChainKey = symChains.receiveChainKey; }
      }
    }

    await entry.transport.acceptAnswer(answer.sdp);
    entry.pendingSignal = null;
    entry.session.transition(SessionStatus.CONNECTING);
    this._setupTransportListeners(sessionId);
    await this._persistSession(sessionId);
    this._emit('update', sessionId);
  }

  // ── Reconnection ──

  async reconnectAsHost(sessionId) {
    const entry = this._entries.get(sessionId);
    if (!entry) throw new Error('Session not found');

    // Close old transport if any
    if (entry.transport) {
      try {
        entry.transport.close();
      } catch {
        /* ignore */
      }
    }

    const transport = this._createTransport(sessionId, this._iceConfig);
    entry.transport = transport;
    const offerSdp = await transport.createOffer();

    const reconnectCode = encodeJson({
      s: offerSdp,
      i: sessionId,
      r: true,
    });

    entry.pendingSignal = {
      type: 'reconnect-invite',
      code: reconnectCode,
    };
    entry.session.transition(SessionStatus.CONNECTING);
    await this._persistSession(sessionId);
    this._emit('update', sessionId);

    return reconnectCode;
  }

  async reconnectAsGuest(sessionId, reconnectCode) {
    const entry = this._entries.get(sessionId);
    if (!entry) throw new Error('Session not found');

    const data = decodeJson(reconnectCode);
    if (data.i !== sessionId) throw new Error('Reconnect code session mismatch');

    // Close old transport if any
    if (entry.transport) {
      try {
        entry.transport.close();
      } catch {
        /* ignore */
      }
    }

    const transport = this._createTransport(sessionId, this._iceConfig);
    entry.transport = transport;
    const answerSdp = await transport.acceptOffer(data.s);

    let cipherText = null;
    if (this._crypto.handshakeMode === 'kem' && entry.session.remoteIdentity) {
      const remotePublicKey = await this._crypto.importPublicKey(
        entry.session.remoteIdentity.publicKeyJwk,
      );
      const encapsulated = await this._crypto.encapsulateSharedKey(remotePublicKey);
      entry.session.sharedKey = encapsulated.sharedKey;
      cipherText = encapsulated.cipherText;
      if (this._crypto.deriveRatchetKeys) {
        const chains = await this._crypto.deriveRatchetKeys(encapsulated.sharedKey, 'guest');
        if (chains) { entry.session.sendChainKey = chains.sendChainKey; entry.session.receiveChainKey = chains.receiveChainKey; }
      }
    }
    // New connection — reset the nonce deduplication set
    entry.seenNonces = new Set();

    const answerCode = encodeJson({ s: answerSdp, i: sessionId, r: true, c: cipherText });

    entry.pendingSignal = {
      type: 'reconnect-answer',
      code: answerCode,
    };
    entry.session.transition(SessionStatus.CONNECTING);
    this._setupTransportListeners(sessionId);
    await this._persistSession(sessionId);
    this._emit('update', sessionId);

    return answerCode;
  }

  async finalizeReconnect(sessionId, answerCode) {
    const entry = this._entries.get(sessionId);
    if (!entry) throw new Error('Session not found');

    const data = decodeJson(answerCode);
    if (data.i !== sessionId) throw new Error('Answer session mismatch');

    if (this._crypto.handshakeMode === 'kem' && data.c) {
      const newKey = await this._crypto.decapsulateSharedKey(
        entry.keyPair.privateKey,
        data.c,
      );
      entry.session.sharedKey = newKey;
      if (this._crypto.deriveRatchetKeys) {
        const chains = await this._crypto.deriveRatchetKeys(newKey, 'host');
      if (chains) { entry.session.sendChainKey = chains.sendChainKey; entry.session.receiveChainKey = chains.receiveChainKey; }
      }
    }
    // New connection — reset the nonce deduplication set
    entry.seenNonces = new Set();

    await entry.transport.acceptAnswer(data.s);
    entry.pendingSignal = null;
    this._setupTransportListeners(sessionId);
    await this._persistSession(sessionId);
    this._emit('update', sessionId);
  }

  // ── Messaging ──

  async sendMessage(sessionId, text) {
    const entry = this._entries.get(sessionId);
    if (!entry) throw new Error('Session not found');
    if (entry.session.status !== SessionStatus.CONNECTED) {
      throw new Error('Session is not connected');
    }

    const counter = entry.session.nextMessageCounter();
    const message = new Message({
      id: crypto.randomUUID(),
      text,
      from: entry.session.localIdentity.fingerprint,
      timestamp: Date.now(),
      counter,
    });

    const envelope = wrapChatMessage(JSON.parse(message.toPlaintext()));
    const encrypted = await this._ratchetEncrypt(entry, envelope);
    entry.transport.send(encrypted);

    entry.messages.push({
      id: message.id,
      text: message.text,
      from: message.from,
      timestamp: message.timestamp,
      counter: message.counter,
      self: true,
    });
    await this._persistSession(sessionId);
    this._emit('message', sessionId, message, true);

    return message;
  }

  // ── Control Messages ──

  async sendTitle(sessionId, title) {
    const entry = this._entries.get(sessionId);
    if (!entry) throw new Error('Session not found');

    entry.session.title = title;

    if (entry.session.status === SessionStatus.CONNECTED && entry.transport) {
      try {
        const envelope = wrapControl(ControlAction.TITLE, { title });
        const encrypted = await this._ratchetEncrypt(entry, envelope);
        if (entry.transport) entry.transport.send(encrypted);
      } catch {
        /* transport may have been closed during async encrypt */
      }
    }

    await this._persistSession(sessionId);
    this._emit('update', sessionId);
  }

  async requestDelete(sessionId) {
    const entry = this._entries.get(sessionId);
    if (!entry) throw new Error('Session not found');

    if (entry.session.status === SessionStatus.CONNECTED && entry.transport) {
      const envelope = wrapControl(ControlAction.DELETE_REQUEST);
      const encrypted = await this._ratchetEncrypt(entry, envelope);
      entry.transport.send(encrypted);
    }

    this._emit('control', sessionId, ControlAction.DELETE_REQUEST, {
      outgoing: true,
    });
  }

  async confirmDelete(sessionId) {
    const entry = this._entries.get(sessionId);
    if (!entry) throw new Error('Session not found');

    if (entry.session.status === SessionStatus.CONNECTED && entry.transport) {
      const envelope = wrapControl(ControlAction.DELETE_CONFIRM);
      const encrypted = await this._ratchetEncrypt(entry, envelope);
      entry.transport.send(encrypted);
    }

    await this.deleteSession(sessionId);
  }

  async deleteSession(sessionId) {
    const entry = this._entries.get(sessionId);
    if (entry?.transport) {
      try {
        entry.transport.close();
      } catch {
        /* ignore */
      }
    }
    // Zero raw key material so GC can reclaim it promptly and it doesn't
    // linger in memory after the session is gone.
    if (entry?.session) {
      const s = entry.session;
      if (s.sendChainKey instanceof Uint8Array) s.sendChainKey.fill(0);
      if (s.receiveChainKey instanceof Uint8Array) s.receiveChainKey.fill(0);
      if (s.rootKey instanceof Uint8Array) s.rootKey.fill(0);
      s.sendChainKey = null;
      s.receiveChainKey = null;
      s.rootKey = null;
      s.sharedKey = null;
      s.dhRatchetPrivateKeyJwk = null;
    }
    this._entries.delete(sessionId);
    await this._removePersistedSession(sessionId);
    this._emit('update', sessionId);
  }

  // ── Connection Management ──

  disconnect(sessionId) {
    const entry = this._entries.get(sessionId);
    if (!entry) return;

    if (entry.transport) {
      try {
        entry.transport.close();
      } catch {
        /* ignore */
      }
      entry.transport = null;
    }

    if (
      entry.session.status === SessionStatus.CONNECTED ||
      entry.session.status === SessionStatus.CONNECTING
    ) {
      entry.session.status = SessionStatus.DISCONNECTED;
    }

    this._persistSession(sessionId);
    this._emit('update', sessionId);
  }

  /**
   * Re-attaches a SharedWorker-held connection to this session after a page
   * refresh. The SharedWorker already owns the RTCPeerConnection; we just
   * need to create a new adapter that subscribes and restores state.
   *
   * @param {string} sessionId
   * @param {'connected'|'connecting'} workerState
   */
  rehydrateConnection(sessionId, workerState) {
    const entry = this._entries.get(sessionId);
    if (!entry) return;

    // Set session status first to avoid invalid transition errors when the
    // subscribe response fires 'connected' on the new adapter.
    if (workerState === 'connected') {
      entry.session.status = SessionStatus.CONNECTED;
    } else if (workerState === 'connecting') {
      entry.session.status = SessionStatus.CONNECTING;
    }

    const transport = this._createTransport(sessionId, { isRehydration: true, ...this._iceConfig });
    entry.transport = transport;
    this._setupTransportListeners(sessionId);
    this._persistSession(sessionId);
    this._emit('update', sessionId);
  }

  // ── Queries ──

  getSessions() {
    return [...this._entries.values()].map((e) => e.session);
  }

  getSession(sessionId) {
    return this._entries.get(sessionId)?.session ?? null;
  }

  getMessages(sessionId) {
    return this._entries.get(sessionId)?.messages ?? [];
  }

  getEntry(sessionId) {
    return this._entries.get(sessionId) ?? null;
  }

  getPendingSignal(sessionId) {
    return this._entries.get(sessionId)?.pendingSignal ?? null;
  }

  // ── Transport Wiring ──

  _setupTransportListeners(sessionId) {
    const entry = this._entries.get(sessionId);
    if (!entry?.transport) return;

    // Capture the transport reference so stale callbacks from replaced
    // transports (e.g. after reconnect) are silently ignored.
    const transport = entry.transport;

    transport.onStateChange((state) => {
      if (!entry.transport || entry.transport !== transport) return;

      if (state === 'connected') {
        // Detect whether this is a brand-new connection (not a rehydration).
        const wasConnecting =
          entry.session.status === SessionStatus.CONNECTING ||
          entry.session.status === SessionStatus.AWAITING_ANSWER ||
          entry.session.status === SessionStatus.AWAITING_FINALIZE;

        if (
          entry.session.status === SessionStatus.AWAITING_ANSWER ||
          entry.session.status === SessionStatus.AWAITING_FINALIZE
        ) {
          entry.session.transition(SessionStatus.CONNECTING);
        }
        if (entry.session.status === SessionStatus.CONNECTING) {
          entry.session.transition(SessionStatus.CONNECTED);
        }

        entry.pendingSignal = null;
        this._persistSession(sessionId);
        this._emit('update', sessionId);

        // Only send title on a real new connection, not on rehydration.
        if (wasConnecting && entry.session.title) {
          this.sendTitle(sessionId, entry.session.title);
        }
      }

      if (
        state === 'disconnected' &&
        (entry.session.status === SessionStatus.CONNECTED ||
          entry.session.status === SessionStatus.CONNECTING)
      ) {
        entry.session.status = SessionStatus.DISCONNECTED;
        this._persistSession(sessionId);
        this._emit('update', sessionId);
      }
    });

    transport.onMessage(async (encryptedData) => {
      if (!entry.transport || entry.transport !== transport) return;
      try {
        const plaintext = await this._ratchetDecrypt(entry, encryptedData);
        const envelope = unwrap(plaintext);

        if (envelope.type === 'message') {
          const msg = Message.fromPlaintext(JSON.stringify(envelope.data));
          if (!entry.session.validateReceivedCounter(msg.counter)) return;

          entry.messages.push({
            id: msg.id,
            text: msg.text,
            from: msg.from,
            timestamp: msg.timestamp,
            counter: msg.counter,
            self: false,
          });
          this._persistSession(sessionId);
          this._emit('message', sessionId, msg, false);
        }

        if (envelope.type === 'control') {
          this._handleControl(sessionId, envelope.action, envelope.data);
        }
      } catch (err) {
        // Surface detectable security failures as observable events rather than
        // silently discarding them.  The message itself stays dropped (we don't
        // crash the session for a single bad packet) but the UI can warn the user.
        const msg = err?.message ?? '';
        if (
          msg.includes('Duplicate nonce') ||
          msg.includes('Too many skipped') ||
          msg.includes('replay')
        ) {
          this._emit('security', sessionId, msg);
        }
        // Generic decryption / parse failures are silently ignored to avoid
        // leaking timing or oracle information.
      }
    });
  }

  // ── Ratchet helpers ──
  // DH healing layer: when _ratchetDecrypt sees a new remote ratchet public key
  // it calls _performDhRatchetStep.  Both receive and send chains are re-derived,
  // providing post-compromise security — an attacker who learns the current chain
  // key loses all advantage after the next DH step.

  async _performDhRatchetStep(entry, newRemoteRatchetPubKeyJwk) {
    const s = entry.session;
    // Step 1: ECDH(my current ratchet private key, remote's new public key)
    const dhOut1 = await this._crypto.dhRatchetEcdh(s.dhRatchetPrivateKeyJwk, newRemoteRatchetPubKeyJwk);
    const { newRootKey: rootAfterRecv, newChainKey: newRecvChain } =
      await this._crypto.advanceRootChain(s.rootKey, dhOut1);

    // Step 2: Generate fresh local ratchet key pair (the "step").
    const newLocalKp = await this._crypto.generateDhRatchetKeyPair();

    // Step 3: ECDH(new local key, same remote public key) → advance root again.
    const dhOut2 = await this._crypto.dhRatchetEcdh(newLocalKp.privateKeyJwk, newRemoteRatchetPubKeyJwk);
    const { newRootKey: rootAfterSend, newChainKey: newSendChain } =
      await this._crypto.advanceRootChain(rootAfterRecv, dhOut2);

    // Commit state updates — old private key is replaced (healing step).
    s.rootKey = rootAfterSend;
    s.receiveChainKey = newRecvChain;
    s.receiveChainIndex = 0;
    s.sendChainKey = newSendChain;
    s.sendChainIndex = 0;
    s.dhRatchetPublicKeyJwk = newLocalKp.publicKeyJwk;
    s.dhRatchetPrivateKeyJwk = newLocalKp.privateKeyJwk;
    s._lastRemoteRatchetPubKeyStr = JSON.stringify(newRemoteRatchetPubKeyJwk);
    // Clear skipped-message-key buffer for the old chain — those keys are no
    // longer reachable after the chain reset.
    s.skippedMessageKeys = new Map();
  }

  async _ratchetEncrypt(entry, plaintext) {
    const s = entry.session;
    // DH ratchet path: emit versioned JSON envelope with current ratchet pub key
    // and per-chain index so the receiver can detect key changes and skip gaps.
    if (s.dhRatchetPublicKeyJwk && s.sendChainKey && this._crypto.advanceChain) {
      const { messageKey, nextChainKey } = await this._crypto.advanceChain(s.sendChainKey);
      s.sendChainKey = nextChainKey;
      const idx = s.sendChainIndex++;
      const ct = await this._crypto.encrypt(plaintext, messageKey);
      return JSON.stringify({ v: 2, pk: JSON.stringify(s.dhRatchetPublicKeyJwk), n: idx, c: ct });
    }
    // Symmetric-ratchet path (no DH ratchet keys available).
    if (s.sendChainKey && this._crypto.advanceChain) {
      const { messageKey, nextChainKey } = await this._crypto.advanceChain(s.sendChainKey);
      s.sendChainKey = nextChainKey;
      return this._crypto.encrypt(plaintext, messageKey);
    }
    return this._crypto.encrypt(plaintext, s.sharedKey);
  }

  async _ratchetDecrypt(entry, ciphertext) {
    const s = entry.session;
    const MAX_SKIP = 100;

    // ─ Attempt to parse as DH ratchet envelope (v:2) ─
    let parsed = null;
    try {
      const obj = JSON.parse(ciphertext);
      if (obj?.v === 2 && typeof obj.pk === 'string' && typeof obj.n === 'number') parsed = obj;
    } catch { /* not a JSON envelope — fall through */ }

    if (parsed) {
      const remoteRatchetPubKeyJwk = JSON.parse(parsed.pk);
      const remoteKeyId = parsed.pk; // stable string identity for Map keys
      const targetN = parsed.n;

      // Nonce dedup from the inner ciphertext field.
      let nonceKey = null;
      try {
        const raw = decode(parsed.c);
        if (raw.length > 12) nonceKey = encode(raw.slice(0, 12));
      } catch { /* non-base64 in tests — skip */ }
      if (nonceKey !== null) {
        if (entry.seenNonces.has(nonceKey)) throw new Error('Duplicate nonce — replay rejected');
        entry.seenNonces.add(nonceKey);
        if (entry.seenNonces.size > 500) entry.seenNonces.delete(entry.seenNonces.values().next().value);
      }

      // Check if this is a new remote ratchet public key → DH healing step.
      if (s.rootKey && s.dhRatchetPrivateKeyJwk &&
          remoteKeyId !== s._lastRemoteRatchetPubKeyStr &&
          this._crypto.dhRatchetEcdh) {
        await this._performDhRatchetStep(entry, remoteRatchetPubKeyJwk);
      }

      // Out-of-order: look up a previously stored message key.
      if (targetN < s.receiveChainIndex) {
        const skipKey = `${remoteKeyId}:${targetN}`;
        const msgKey = s.skippedMessageKeys.get(skipKey);
        if (!msgKey) throw new Error('Ratchet message key not found (too old or already consumed)');
        s.skippedMessageKeys.delete(skipKey);
        return this._crypto.decrypt(parsed.c, msgKey);
      }

      // Advance the chain, buffering skipped keys for any gap.
      if (targetN - s.receiveChainIndex > MAX_SKIP)
        throw new Error(`Too many skipped ratchet messages: ${targetN - s.receiveChainIndex}`);
      while (s.receiveChainIndex < targetN) {
        const { messageKey, nextChainKey } = await this._crypto.advanceChain(s.receiveChainKey);
        s.skippedMessageKeys.set(`${remoteKeyId}:${s.receiveChainIndex}`, messageKey);
        s.receiveChainKey = nextChainKey;
        s.receiveChainIndex++;
        if (s.skippedMessageKeys.size > MAX_SKIP * 2) {
          s.skippedMessageKeys.delete(s.skippedMessageKeys.keys().next().value);
        }
      }

      const { messageKey, nextChainKey } = await this._crypto.advanceChain(s.receiveChainKey);
      s.receiveChainKey = nextChainKey;
      s.receiveChainIndex++;
      return this._crypto.decrypt(parsed.c, messageKey);
    }

    // ─ Old-format path (symmetric ratchet or shared key) ─
    // Nonce dedup on the raw ciphertext.
    let nonceKey = null;
    try {
      const raw = decode(ciphertext);
      if (raw.length > 12) nonceKey = encode(raw.slice(0, 12));
    } catch { /* non-base64 in tests — skip */ }
    if (nonceKey !== null) {
      if (entry.seenNonces.has(nonceKey)) throw new Error('Duplicate nonce — replay rejected');
      entry.seenNonces.add(nonceKey);
      if (entry.seenNonces.size > 500) entry.seenNonces.delete(entry.seenNonces.values().next().value);
    }

    if (s.receiveChainKey && this._crypto.advanceChain) {
      const { messageKey, nextChainKey } = await this._crypto.advanceChain(s.receiveChainKey);
      s.receiveChainKey = nextChainKey;
      return this._crypto.decrypt(ciphertext, messageKey);
    }
    return this._crypto.decrypt(ciphertext, s.sharedKey);
  }

  _handleControl(sessionId, action, data) {
    const entry = this._entries.get(sessionId);
    if (!entry) return;

    if (action === ControlAction.TITLE && data?.title) {
      // Persist the host's title on the guest side
      entry.session.title = data.title;
      this._persistSession(sessionId);
      this._emit('control', sessionId, ControlAction.TITLE, { title: data.title });
      this._emit('update', sessionId);
    }

    if (action === ControlAction.DELETE_REQUEST) {
      this._emit('control', sessionId, ControlAction.DELETE_REQUEST, {
        outgoing: false,
      });
    }

    if (action === ControlAction.DELETE_CONFIRM) {
      this.deleteSession(sessionId);
    }
  }
}
