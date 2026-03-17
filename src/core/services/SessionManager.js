import { Session, SessionStatus } from '../domain/Session.js';
import { PeerIdentity } from '../domain/PeerIdentity.js';
import { Message } from '../domain/Message.js';
import {
  wrapChatMessage,
  wrapControl,
  unwrap,
  ControlAction,
} from '../domain/Envelope.js';
import { encodeJson, decodeJson } from '../../shared/encoding/base64url.js';

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

    // Map<sessionId, { session, transport, keyPair, privateKeyJwk, messages }>
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

      // Re-derive sharedKey if we have the crypto material
      if (privateKeyJwk && session.remoteIdentity) {
        try {
          const privateKey = await this._crypto.importPrivateKey
            ? await this._crypto.importPrivateKey(privateKeyJwk)
            : await crypto.subtle.importKey(
                'jwk',
                privateKeyJwk,
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                ['deriveKey'],
              );
          const remotePublicKey = await this._crypto.importPublicKey(
            session.remoteIdentity.publicKeyJwk,
          );
          session.sharedKey = await this._crypto.deriveSharedKey(
            privateKey,
            remotePublicKey,
          );
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
      });
    }
  }

  async _persistSession(id) {
    const entry = this._entries.get(id);
    if (!entry) return;

    let privateKeyJwk = entry.privateKeyJwk;
    if (!privateKeyJwk && entry.keyPair) {
      try {
        privateKeyJwk = await this._crypto.exportPublicKey
          ? await crypto.subtle.exportKey('jwk', entry.keyPair.privateKey)
          : null;
      } catch {
        // Non-exportable key
      }
    }

    await this._storage.save(
      sessionStorageKey(id),
      entry.session.toSerializable(privateKeyJwk),
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
    const inviteCode = this._signaling.encodeOffer({
      sdp: offerSdp,
      publicKeyJwk: localId.publicKeyJwk,
      sessionId,
      createdAt: session.createdAt,
    });

    session.transition(SessionStatus.AWAITING_ANSWER);

    const privateKeyJwk = await crypto.subtle.exportKey(
      'jwk',
      localId.keyPair.privateKey,
    );

    const entry = {
      session,
      transport,
      keyPair: localId.keyPair,
      privateKeyJwk,
      messages: [],
    };
    this._entries.set(sessionId, entry);
    await this._persistSession(sessionId);
    this._emit('update', sessionId);

    return { sessionId, inviteCode };
  }

  async joinSession(inviteCode) {
    const offer = this._signaling.decodeOffer(inviteCode);
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
    const remoteFingerprint = await this._crypto.fingerprint(
      offer.publicKeyJwk,
    );
    session.remoteIdentity = new PeerIdentity({
      publicKeyJwk: offer.publicKeyJwk,
      fingerprint: remoteFingerprint,
    });

    const sharedKey = await this._crypto.deriveSharedKey(
      localId.keyPair.privateKey,
      remotePublicKey,
    );
    session.sharedKey = sharedKey;

    const answerSdp = await transport.acceptOffer(offer.sdp);
    const answerCode = this._signaling.encodeAnswer({
      sdp: answerSdp,
      publicKeyJwk: localId.publicKeyJwk,
      sessionId: offer.sessionId,
    });

    session.transition(SessionStatus.AWAITING_FINALIZE);

    const privateKeyJwk = await crypto.subtle.exportKey(
      'jwk',
      localId.keyPair.privateKey,
    );

    const entry = {
      session,
      transport,
      keyPair: localId.keyPair,
      privateKeyJwk,
      messages: [],
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

    const sharedKey = await this._crypto.deriveSharedKey(
      entry.keyPair.privateKey,
      remotePublicKey,
    );
    entry.session.sharedKey = sharedKey;

    await entry.transport.acceptAnswer(answer.sdp);
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
    const answerCode = encodeJson({ s: answerSdp, i: sessionId, r: true });

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

    await entry.transport.acceptAnswer(data.s);
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
    const encrypted = await this._crypto.encrypt(
      envelope,
      entry.session.sharedKey,
    );
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
        const encrypted = await this._crypto.encrypt(
          envelope,
          entry.session.sharedKey,
        );
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
      const encrypted = await this._crypto.encrypt(
        envelope,
        entry.session.sharedKey,
      );
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
      const encrypted = await this._crypto.encrypt(
        envelope,
        entry.session.sharedKey,
      );
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
        const plaintext = await this._crypto.decrypt(
          encryptedData,
          entry.session.sharedKey,
        );
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
