import { HybridPqCryptoAdapter } from '../adapters/crypto/HybridPqCryptoAdapter.js';
import { WebCryptoEcdhAesGcm } from '../adapters/crypto/WebCryptoEcdhAesGcm.js';
import { EphemeralIdentityAdapter } from '../adapters/identity/EphemeralIdentityAdapter.js';
import { ManualCodeSignalingAdapter } from '../adapters/signaling/ManualCodeSignalingAdapter.js';
import { MemoryStorageAdapter } from '../adapters/storage/MemoryStorageAdapter.js';
import { IndexedDbStorageAdapter } from '../adapters/storage/IndexedDbStorageAdapter.js';
import { WebRtcTransportAdapter } from '../adapters/transport/WebRtcTransportAdapter.js';
import { SharedWorkerTransportAdapter } from '../adapters/transport/SharedWorkerTransportAdapter.js';
import { CreateChatSession } from '../core/usecases/CreateChatSession.js';
import { JoinChatSession } from '../core/usecases/JoinChatSession.js';
import { FinalizeHandshake } from '../core/usecases/FinalizeHandshake.js';
import { SendMessage } from '../core/usecases/SendMessage.js';
import { ReceiveMessage } from '../core/usecases/ReceiveMessage.js';
import { VerifyFingerprint } from '../core/usecases/VerifyFingerprint.js';
import { SessionManager } from '../core/services/SessionManager.js';

/**
 * Routes messages from a SharedWorker port to per-session handlers.
 * Holds a single MessagePort and dispatches to registered callbacks by sessionId.
 * Supports a liveness probe: if the worker reports that RTCPeerConnection is
 * unavailable, or if markDead() is called (e.g. on load error / timeout), any
 * subsequent createTransport call falls back to WebRtcTransportAdapter.
 */
class WorkerRouter {
  constructor(port) {
    this._port = port;
    this._routes = new Map();
    this._initCallbacks = [];
    this._initSessions = null; // cached once init arrives
    this._dead = false;
    port.addEventListener('message', (e) => this._dispatch(e.data));
    port.start();
  }

  /**
   * True once the init message has arrived AND RTCPeerConnection is available
   * in the worker. False until then (including after markDead()).
   */
  get isAlive() {
    return this._initSessions !== null && !this._dead;
  }

  /** Call to permanently disable SharedWorker for this session. */
  markDead() {
    this._dead = true;
  }

  /** Register a handler for a specific session's worker messages. */
  register(sessionId, handler) {
    this._routes.set(sessionId, handler);
  }

  /** Remove the handler for a session (e.g. after close). */
  unregister(sessionId) {
    this._routes.delete(sessionId);
  }

  /** Send a command to the shared worker. */
  send(msg) {
    this._port.postMessage(msg);
  }

  /**
   * Register a callback for the init event. If init already arrived, the
   * callback is invoked synchronously with the cached session list.
   */
  onInit(callback) {
    if (this._initSessions !== null) {
      callback(this._initSessions);
    } else {
      this._initCallbacks.push(callback);
    }
  }

  _dispatch(msg) {
    if (msg.type === 'init') {
      // If the worker reports RTCPeerConnection is unavailable, treat it as dead.
      if (msg.noWebRtc) this._dead = true;
      this._initSessions = msg.sessions;
      for (const cb of this._initCallbacks) cb(msg.sessions);
      this._initCallbacks = [];
      return;
    }
    const handler = this._routes.get(msg.sessionId);
    if (handler) handler(msg);
  }
}

/**
 * Composition root — wires adapters to use cases.
 * Change adapter instantiation here to swap implementations.
 */
export function createSessionService() {
  const cryptoAdapter = new WebCryptoEcdhAesGcm();
  const storage = new MemoryStorageAdapter();
  const signaling = new ManualCodeSignalingAdapter();
  const identity = new EphemeralIdentityAdapter({ crypto: cryptoAdapter });
  const transport = new WebRtcTransportAdapter();

  return {
    createChatSession: new CreateChatSession({
      transport,
      signaling,
      identity,
    }),
    joinChatSession: new JoinChatSession({
      transport,
      signaling,
      crypto: cryptoAdapter,
      identity,
    }),
    finalizeHandshake: new FinalizeHandshake({
      transport,
      signaling,
      crypto: cryptoAdapter,
    }),
    sendMessage: new SendMessage({ transport, crypto: cryptoAdapter }),
    receiveMessage: new ReceiveMessage({ crypto: cryptoAdapter }),
    verifyFingerprint: new VerifyFingerprint(),
    transport,
    storage,
  };
}

/**
 * Creates a SessionManager with IndexedDB persistence and WebRTC transport.
 * Returns both the manager and the WorkerRouter (may be null if SharedWorker
 * is unavailable) so the caller can handle the initial rehydration event.
 *
 * @returns {{ manager: SessionManager, router: WorkerRouter|null }}
 */
export function createSessionManager() {
  const cryptoAdapter = new HybridPqCryptoAdapter();
  const storage =
    typeof indexedDB !== 'undefined'
      ? new IndexedDbStorageAdapter()
      : new MemoryStorageAdapter();
  const signaling = new ManualCodeSignalingAdapter();
  const identity = new EphemeralIdentityAdapter({ crypto: cryptoAdapter });

  // Attempt to create a SharedWorker so WebRTC connections survive page refresh.
  let workerRouter = null;
  try {
    if (typeof SharedWorker !== 'undefined') {
      const workerUrl = new URL('../workers/rtc.worker.js', import.meta.url);
      const sw = new SharedWorker(workerUrl, {
        type: 'module',
        name: 'p2p-rtc-core',
        extendedLifetime: true,
      });
      workerRouter = new WorkerRouter(sw.port);
      // If the worker fails to load, mark it dead so we fall back to direct WebRTC.
      sw.onerror = () => workerRouter?.markDead();
    }
  } catch {
    // SharedWorker unavailable — fall back to per-page WebRTC.
  }

  const manager = new SessionManager({
    crypto: cryptoAdapter,
    signaling,
    identity,
    storage,
    // Use SharedWorkerTransportAdapter only when the router is confirmed alive.
    // The router becomes alive once the worker sends its init message with
    // RTCPeerConnection available. Falls back to direct WebRTC otherwise.
    createTransport: (sessionId, opts = {}) =>
      workerRouter?.isAlive
        ? new SharedWorkerTransportAdapter(sessionId, workerRouter, opts)
        : new WebRtcTransportAdapter(opts),
  });

  return { manager, router: workerRouter };
}
