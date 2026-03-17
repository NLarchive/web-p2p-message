import { describe, it, expect } from 'vitest';
import { ManualCodeSignalingAdapter } from '../../../src/adapters/signaling/ManualCodeSignalingAdapter.js';

describe('ManualCodeSignalingAdapter', () => {
  const adapter = new ManualCodeSignalingAdapter();

  const sampleOffer = {
    sdp: { type: 'offer', sdp: 'v=0\r\n...' },
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' },
    sessionId: 'session-123',
    createdAt: Date.now(),
  };

  it('encodes and decodes an offer round-trip', () => {
    const encoded = adapter.encodeOffer(sampleOffer);
    expect(typeof encoded).toBe('string');
    const decoded = adapter.decodeOffer(encoded);
    expect(decoded.sdp).toEqual(sampleOffer.sdp);
    expect(decoded.publicKeyJwk).toEqual(sampleOffer.publicKeyJwk);
    expect(decoded.sessionId).toBe(sampleOffer.sessionId);
    expect(decoded.createdAt).toBe(sampleOffer.createdAt);
  });

  it('encodes and decodes an answer round-trip', () => {
    const answer = {
      sdp: { type: 'answer', sdp: 'v=0\r\n...' },
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'c', y: 'd' },
      sessionId: 'session-123',
    };
    const encoded = adapter.encodeAnswer(answer);
    const decoded = adapter.decodeAnswer(encoded);
    expect(decoded.sdp).toEqual(answer.sdp);
    expect(decoded.publicKeyJwk).toEqual(answer.publicKeyJwk);
    expect(decoded.sessionId).toBe(answer.sessionId);
  });

  it('throws InvalidInviteError for garbage input', () => {
    expect(() => adapter.decodeOffer('not-valid-base64!!!')).toThrow(
      'Could not decode',
    );
    expect(() => adapter.decodeAnswer('not-valid-base64!!!')).toThrow(
      'Could not decode',
    );
  });

  it('throws InvalidInviteError for missing fields', async () => {
    const { encodeJson } = await import(
      '../../../src/shared/encoding/base64url.js'
    );
    // encoded but missing required keys
    const bad = encodeJson({ s: null, k: null });
    expect(() => adapter.decodeOffer(bad)).toThrow('missing required');
  });

  it('throws SessionExpiredError for expired offers', () => {
    const expired = {
      ...sampleOffer,
      createdAt: Date.now() - 600_000, // 10 min ago
    };
    const encoded = adapter.encodeOffer(expired);
    expect(() => adapter.decodeOffer(encoded)).toThrow('expired');
  });
});
