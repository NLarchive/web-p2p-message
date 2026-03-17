import { describe, it, expect } from 'vitest';
import {
  wrapChatMessage,
  wrapControl,
  unwrap,
  ControlAction,
} from '../../../src/core/domain/Envelope.js';

describe('Envelope', () => {
  it('wraps and unwraps a chat message', () => {
    const data = { id: '1', text: 'hello', from: 'abc', counter: 1 };
    const json = wrapChatMessage(data);
    const result = unwrap(json);
    expect(result.type).toBe('message');
    expect(result.data).toEqual(data);
  });

  it('wraps and unwraps a control message', () => {
    const json = wrapControl(ControlAction.TITLE, { title: 'Work Chat' });
    const result = unwrap(json);
    expect(result.type).toBe('control');
    expect(result.action).toBe('title');
    expect(result.data.title).toBe('Work Chat');
  });

  it('wraps delete request with no data', () => {
    const json = wrapControl(ControlAction.DELETE_REQUEST);
    const result = unwrap(json);
    expect(result.type).toBe('control');
    expect(result.action).toBe('delete_req');
  });

  it('wraps delete confirm', () => {
    const json = wrapControl(ControlAction.DELETE_CONFIRM);
    const result = unwrap(json);
    expect(result.type).toBe('control');
    expect(result.action).toBe('delete_ack');
  });

  it('throws on unknown envelope type', () => {
    expect(() => unwrap('{"t":"x"}')).toThrow('Unknown envelope type');
  });

  it('parses from object', () => {
    const result = unwrap({ t: 'm', d: { text: 'hi' } });
    expect(result.type).toBe('message');
    expect(result.data.text).toBe('hi');
  });
});
