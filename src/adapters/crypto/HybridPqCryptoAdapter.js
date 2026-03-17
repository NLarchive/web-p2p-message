import { ICryptoPort } from '../../core/ports/ICryptoPort.js';

/**
 * Placeholder for hybrid post-quantum crypto adapter.
 * Will combine classical ECDH with ML-KEM (CRYSTALS-Kyber) for quantum resistance.
 * Not implemented in MVP — use WebCryptoEcdhAesGcm instead.
 */
export class HybridPqCryptoAdapter extends ICryptoPort {}
