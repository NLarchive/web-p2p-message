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
const messagesStorageKey = (id) => `messages:${id}`;

export class SessionManager {
  constructor({ crypto, signaling, identity, storage, createTransport }) {
    this._crypto = crypto;
    this._signaling = signaling;
    this._identity = identity;
    this._storage = storage;
    this._createTransport = createTransport;

    // Map<sessionId, { session, transport, keyPair, privateKeyJwk, messages, pendingSignal }>
    this._entries = new Map();
    this._listeners = {};
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
      const { session, privateKeyJwk } = Session.fromSerializable(data);

      if (data.sharedKey && this._crypto.importSharedKey) {
        try {
          session.sharedKey = await this._crypto.importSharedKey(data.sharedKey);
        } catch {
          // Can't restore shared key; reconnect flow will regenerate it.
        }
      }

      // Re-derive sharedKey if we have the crypto material
      if (
        !session.sharedKey &&
        this._crypto.handshakeMode === 'dh' &&
        privateKeyJwk &&
        session.remoteIdentity
      ) {
        try {
          if (this._crypto.importPrivateKey && this._crypto.deriveSharedKey) {
            const privateKey = await this._crypto.importPrivateKey(privateKeyJwk);
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

      const messages = (await this._storage.load(messagesStorageKey(id))) ?? [];
      this._entries.set(id, {
        session,
        transport: null,
        keyPair: null,
        privateKeyJwk,
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

    let sharedKey = null;
    if (entry.session.sharedKey && this._crypto.exportSharedKey) {
      try {
        sharedKey = await this._crypto.exportSharedKey(entry.session.sharedKey);
      } catch {
        // Non-exportable session key
      }
    }

    await this._storage.save(
      sessionStorageKey(id),
      {
        ...entry.session.toSerializable(privateKeyJwk),
        sharedKey,
        pendingSignal: entry.pendingSignal ?? null,
      },
    );
    await this._storage.save(messagesStorageKey(id), entry.messages);

    // Update index
    const ids = [...this._entries.keys()];
    await this._storage.save(STORAGE_INDEX_KEY, ids);
  }

  async _removePersistedSession(id) {
    await this._storage.remove(sessionStorageKey(id));
    await this._storage.remove(messagesStorageKey(id));
    const ids = [...this._entries.keys()].filter((k) => k !== id);
    await this._storage.save(STORAGE_INDEX_KEY, ids);
  }

  // ── Session Lifecycle ──

  async createSession(title) {
    const sessionId = crypto.randomUUID();
    const transport = this._createTransport(sessionId);
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
    if (this._crypto.generateSigningKeyPair) {
      try {
        const signingKeyPair = await this._crypto.generateSigningKeyPair();
        signingPublicKeyJwk = await this._crypto.exportSigningPublicKey(signingKeyPair.publicKey);
        const canonical = inviteCanonicalBytes({
          sdp: offerSdp,
          publicKeyJwk: localId.publicKeyJwk,
          sessionId,
          createdAt: session.createdAt,
          signingPublicKeyJwk,
        });
        const sigBytes = await this._crypto.signPayload(canonical, signingKeyPair.privateKey);
        signature = encode(sigBytes);
      } catch {
        signingPublicKeyJwk = null;
        signature = null;
      }
    }

    // Extend local fingerprint to cover both KEM key and signing key.
    if (signingPublicKeyJwk) {
      const combinedFp = await this._crypto.fingerprint(localId.publicKeyJwk, signingPublicKeyJwk);
      session.localIdentity.fingerprint = combinedFp;
    }

    const inviteCode = this._signaling.encodeOffer({
      sdp: offerSdp,
      publicKeyJwk: localId.publicKeyJwk,
      sessionId,
      createdAt: session.createdAt,
      signingPublicKeyJwk,
      signature,
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
      });
      const sigBytes = decode(offer.signature);
      const valid = await this._crypto.verifyPayload(canonical, sigBytes, offer.signingPublicKeyJwk);
      if (!valid) {
        throw new InvalidInviteError('Invite signature is invalid — payload may have been tampered');
      }
    }

    const transport = this._createTransport(offer.sessionId);
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
    if (this._crypto.deriveRatchetKeys) {
      const chains = await this._crypto.deriveRatchetKeys(sharedKey, 'guest');
      if (chains) { session.sendChainKey = chains.sendChainKey; session.receiveChainKey = chains.receiveChainKey; }
    }

    const answerSdp = await transport.acceptOffer(offer.sdp);
    const answerCode = this._signaling.encodeAnswer({
      sdp: answerSdp,
      publicKeyJwk: localId.publicKeyJwk,
      sessionId: offer.sessionId,
      cipherText,
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
    if (this._crypto.deriveRatchetKeys) {
      const chains = await this._crypto.deriveRatchetKeys(sharedKey, 'host');
      if (chains) { entry.session.sendChainKey = chains.sendChainKey; entry.session.receiveChainKey = chains.receiveChainKey; }
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

    const transport = this._createTransport(sessionId);
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

    const transport = this._createTransport(sessionId);
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

    const transport = this._createTransport(sessionId, { isRehydration: true });
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
      } catch {
        // Decryption or parse failure — ignore
      }
    });
  }

  // ── Ratchet helpers ──
  // When deriveRatchetKeys / advanceChain are available (real crypto adapters),
  // each message uses a fresh AES-GCM key derived by HMAC-advancing the chain.
  // When they are not (mocked in tests), fall back to the static sharedKey so
  // that the entire existing mock-based test suite continues to pass unchanged.

  async _ratchetEncrypt(entry, plaintext) {
    if (entry.session.sendChainKey && this._crypto.advanceChain) {
      const { messageKey, nextChainKey } = await this._crypto.advanceChain(entry.session.sendChainKey);
      entry.session.sendChainKey = nextChainKey;
      return this._crypto.encrypt(plaintext, messageKey);
    }
    return this._crypto.encrypt(plaintext, entry.session.sharedKey);
  }

  async _ratchetDecrypt(entry, ciphertext) {
    // Nonce deduplication: extract the 12-byte AES-GCM IV and reject replays.
    // Silently skipped when ciphertext is not valid base64url (e.g. in mock tests).
    let nonceKey = null;
    try {
      const raw = decode(ciphertext);
      if (raw.length > 12) nonceKey = encode(raw.slice(0, 12));
    } catch {
      // Non-base64url ciphertext (mock encrypt in tests) — no nonce to track
    }
    if (nonceKey !== null) {
      if (entry.seenNonces.has(nonceKey)) throw new Error('Duplicate nonce — replay rejected');
      entry.seenNonces.add(nonceKey);
      // Bound to ~6 KB per session — evict oldest nonce once the cap is reached
      if (entry.seenNonces.size > 500) {
        entry.seenNonces.delete(entry.seenNonces.values().next().value);
      }
    }
    if (entry.session.receiveChainKey && this._crypto.advanceChain) {
      const { messageKey, nextChainKey } = await this._crypto.advanceChain(entry.session.receiveChainKey);
      entry.session.receiveChainKey = nextChainKey;
      return this._crypto.decrypt(ciphertext, messageKey);
    }
    return this._crypto.decrypt(ciphertext, entry.session.sharedKey);
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
