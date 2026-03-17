import { describe, it, expect } from 'vitest';
import { MemoryStorageAdapter } from '../../../src/adapters/storage/MemoryStorageAdapter.js';

describe('MemoryStorageAdapter', () => {
  it('stores and retrieves values', async () => {
    const store = new MemoryStorageAdapter();
    await store.save('key1', { data: 'hello' });
    expect(await store.load('key1')).toEqual({ data: 'hello' });
  });

  it('returns null for missing keys', async () => {
    const store = new MemoryStorageAdapter();
    expect(await store.load('missing')).toBeNull();
  });

  it('deep-copies values on save and load', async () => {
    const store = new MemoryStorageAdapter();
    const obj = { nested: { value: 1 } };
    await store.save('key', obj);
    obj.nested.value = 999;
    const loaded = await store.load('key');
    expect(loaded.nested.value).toBe(1);
  });

  it('removes keys', async () => {
    const store = new MemoryStorageAdapter();
    await store.save('key', 'value');
    await store.remove('key');
    expect(await store.load('key')).toBeNull();
  });

  it('clears all keys', async () => {
    const store = new MemoryStorageAdapter();
    await store.save('a', 1);
    await store.save('b', 2);
    await store.clear();
    expect(await store.load('a')).toBeNull();
    expect(await store.load('b')).toBeNull();
  });
});
