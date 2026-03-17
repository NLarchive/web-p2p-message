import { describe, it, expect } from 'vitest';
import { Message } from '../../../src/core/domain/Message.js';

describe('Message', () => {
  it('creates a valid message', () => {
    const m = new Message({
      id: 'm1',
      text: 'Hello',
      from: 'fp:abc',
      counter: 1,
    });
    expect(m.id).toBe('m1');
    expect(m.text).toBe('Hello');
    expect(m.from).toBe('fp:abc');
    expect(m.counter).toBe(1);
    expect(m.timestamp).toBeTypeOf('number');
  });

  it('rejects empty text', () => {
    expect(
      () => new Message({ id: 'm', text: '', from: 'fp', counter: 1 }),
    ).toThrow('empty');
  });

  it('rejects non-string text', () => {
    expect(
      () => new Message({ id: 'm', text: 123, from: 'fp', counter: 1 }),
    ).toThrow('string');
  });

  it('rejects text exceeding max length', () => {
    const long = 'a'.repeat(10001);
    expect(
      () => new Message({ id: 'm', text: long, from: 'fp', counter: 1 }),
    ).toThrow('exceed');
  });

  it('rejects invalid counter', () => {
    expect(
      () => new Message({ id: 'm', text: 'hi', from: 'fp', counter: 0 }),
    ).toThrow('counter');
    expect(
      () => new Message({ id: 'm', text: 'hi', from: 'fp', counter: -1 }),
    ).toThrow('counter');
  });

  it('serializes and deserializes via plaintext', () => {
    const m = new Message({
      id: 'm2',
      text: 'Round-trip',
      from: 'fp:xyz',
      counter: 5,
      timestamp: 1000,
    });
    const json = m.toPlaintext();
    const m2 = Message.fromPlaintext(json);
    expect(m2.id).toBe('m2');
    expect(m2.text).toBe('Round-trip');
    expect(m2.from).toBe('fp:xyz');
    expect(m2.counter).toBe(5);
    expect(m2.timestamp).toBe(1000);
  });
});
