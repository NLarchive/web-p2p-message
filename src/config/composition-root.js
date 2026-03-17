import { WebCryptoEcdhAesGcm } from '../adapters/crypto/WebCryptoEcdhAesGcm.js';
import { EphemeralIdentityAdapter } from '../adapters/identity/EphemeralIdentityAdapter.js';
import { ManualCodeSignalingAdapter } from '../adapters/signaling/ManualCodeSignalingAdapter.js';
import { MemoryStorageAdapter } from '../adapters/storage/MemoryStorageAdapter.js';
import { WebRtcTransportAdapter } from '../adapters/transport/WebRtcTransportAdapter.js';
import { CreateChatSession } from '../core/usecases/CreateChatSession.js';
import { JoinChatSession } from '../core/usecases/JoinChatSession.js';
import { FinalizeHandshake } from '../core/usecases/FinalizeHandshake.js';
import { SendMessage } from '../core/usecases/SendMessage.js';
import { ReceiveMessage } from '../core/usecases/ReceiveMessage.js';
import { VerifyFingerprint } from '../core/usecases/VerifyFingerprint.js';

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
