import { describe, it, expect } from 'vitest';
import {
  encode,
  decode,
  encodeText,
  decodeText,
  encodeJson,
  decodeJson,
} from '../../../src/shared/encoding/base64url.js';

describe('base64url', () => {
  it('encodes and decodes binary data', () => {
    const data = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const encoded = encode(data);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    const decoded = decode(encoded);
    expect(decoded).toEqual(data);
  });

  it('encodes and decodes ArrayBuffer', () => {
    const buf = new Uint8Array([10, 20, 30]).buffer;
    const encoded = encode(buf);
    const decoded = decode(encoded);
    expect(decoded).toEqual(new Uint8Array([10, 20, 30]));
  });

  it('encodes and decodes text', () => {
    const text = 'Hello, World! 🌍';
    const encoded = encodeText(text);
    expect(decodeText(encoded)).toBe(text);
  });

  it('encodes and decodes JSON', () => {
    const obj = { key: 'value', num: 42, arr: [1, 2, 3] };
    const encoded = encodeJson(obj);
    expect(decodeJson(encoded)).toEqual(obj);
  });

  it('handles empty input', () => {
    const encoded = encode(new Uint8Array([]));
    const decoded = decode(encoded);
    expect(decoded.length).toBe(0);
  });
});
