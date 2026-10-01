import { describe, expect, it } from 'vitest';
import { type CacheStore, createInMemoryCacheStore } from '../src/cache-store';

type Rows = readonly Record<string, unknown>[];

function controlledClock(start = 0) {
  let now = start;
  return {
    clock: () => now,
    advanceTo(time: number) {
      now = time;
    },
  };
}

async function put<TValue>(store: CacheStore<unknown, TValue>, key: string, value: TValue) {
  return store.set(await store.get({ key, meta: undefined }), value);
}

async function storedValue<TValue>(store: CacheStore<unknown, TValue>, key: string) {
  const { data } = await store.get({ key, meta: undefined });
  return data.empty ? undefined : data.value;
}

async function versionOf<TValue>(store: CacheStore<unknown, TValue>, key: string) {
  return (await store.get({ key, meta: undefined })).version;
}

describe('createInMemoryCacheStore', () => {
  describe('options', () => {
    it.each([
      ['ttlMs', { ttlMs: 0 }],
      ['ttlMs', { ttlMs: -1 }],
      ['ttlMs', { ttlMs: Number.NaN }],
      ['maxEntries', { maxEntries: 0 }],
      ['maxEntries', { maxEntries: -1 }],
      ['maxEntries', { maxEntries: 1.5 }],
      ['maxEntries', { maxEntries: Number.NaN }],
      ['maxEntries', { maxEntries: Number.POSITIVE_INFINITY }],
    ])('rejects an invalid %s (%o)', (argument, options) => {
      expect(() => createInMemoryCacheStore(options)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.ARGUMENT_INVALID',
          meta: {
            helper: 'createInMemoryCacheStore',
            argument,
            received: Object.values(options)[0],
          },
        }),
      );
    });

    it('accepts ttlMs: Infinity and a positive integer maxEntries', () => {
      expect(() =>
        createInMemoryCacheStore<unknown, unknown>({
          ttlMs: Number.POSITIVE_INFINITY,
          maxEntries: 1,
        }),
      ).not.toThrow();
    });
  });

  describe('get and set', () => {
    it('returns an empty entry with version 0 for a key never seen, carrying the meta given', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();

      expect(await store.get({ key: 'absent', meta: { tags: ['users'] } })).toEqual({
        key: 'absent',
        meta: { tags: ['users'] },
        version: 0,
        data: { empty: true },
      });
    });

    it('stores the value set on the entry get returned, and a later get returns it', async () => {
      const store = createInMemoryCacheStore<unknown, Rows>();
      const entry = await store.get({ key: 'k', meta: undefined });

      expect(await store.set(entry, [{ id: 1 }, { id: 2 }])).toBe(true);

      expect(await store.get({ key: 'k', meta: undefined })).toEqual({
        key: 'k',
        meta: undefined,
        version: 0,
        data: { empty: false, value: [{ id: 1 }, { id: 2 }] },
      });
    });

    it('round-trips any value type', async () => {
      const store = createInMemoryCacheStore<unknown, { readonly n: number; readonly s: string }>();
      const value = { n: 1, s: 'x' };

      await put(store, 'k', value);

      expect(await storedValue(store, 'k')).toBe(value);
    });

    it('overwrites a value through a set on the non-empty entry get returned', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      await put(store, 'k', 1);

      expect(await put(store, 'k', 2)).toBe(true);

      expect(await storedValue(store, 'k')).toBe(2);
    });

    it('ignores meta in get and set', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      await store.set(await store.get({ key: 'k', meta: { tags: ['users'] } }), 1);

      expect(await store.get({ key: 'k', meta: { tags: ['posts'] } })).toEqual({
        key: 'k',
        meta: { tags: ['posts'] },
        version: 0,
        data: { empty: false, value: 1 },
      });
    });
  });

  describe('versions', () => {
    it('does not change the version on set', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      await store.unset({ keys: ['k'], meta: undefined });

      await put(store, 'k', 1);

      expect(await versionOf(store, 'k')).toBe(1);
    });

    it('stores nothing and returns false when the version moved after get', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      const entry = await store.get({ key: 'k', meta: undefined });
      await store.unset({ keys: ['k'], meta: undefined });

      expect(await store.set(entry, 1)).toBe(false);

      expect(await storedValue(store, 'k')).toBeUndefined();
    });

    it('refuses a refresh on a non-empty entry whose version moved', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      await put(store, 'k', 1);
      const entry = await store.get({ key: 'k', meta: undefined });
      await store.unset({ keys: ['k'], meta: undefined });

      expect(await store.set(entry, 2)).toBe(false);
      expect(await storedValue(store, 'k')).toBeUndefined();
    });

    it('increments the version of a key unset removes', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      await put(store, 'k', 1);

      await store.unset({ keys: ['k'], meta: undefined });

      expect(await store.get({ key: 'k', meta: undefined })).toEqual({
        key: 'k',
        meta: undefined,
        version: 1,
        data: { empty: true },
      });
    });

    it('increments the version of a key unset names that holds no value', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();

      await store.unset({ keys: ['absent'], meta: undefined });
      await store.unset({ keys: ['absent'], meta: undefined });

      expect(await versionOf(store, 'absent')).toBe(2);
    });

    it('forgets the version of a key ttlMs after the unset that set it', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore<unknown, unknown>({ ttlMs: 100, clock: time.clock });
      await store.unset({ keys: ['k'], meta: undefined });

      time.advanceTo(99);
      expect(await versionOf(store, 'k')).toBe(1);

      time.advanceTo(100);
      expect(await versionOf(store, 'k')).toBe(0);
    });

    it('keeps the versions of other keys when one key is invalidated again', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore<unknown, unknown>({ ttlMs: 100, clock: time.clock });
      await store.unset({ keys: ['a'], meta: undefined });
      time.advanceTo(50);
      await store.unset({ keys: ['b'], meta: undefined });
      time.advanceTo(60);
      await store.unset({ keys: ['a'], meta: undefined });

      time.advanceTo(150);

      expect(await versionOf(store, 'b')).toBe(0);
      expect(await versionOf(store, 'a')).toBe(2);
    });

    it('never forgets a version when ttlMs is Infinity', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore<unknown, unknown>({
        ttlMs: Number.POSITIVE_INFINITY,
        clock: time.clock,
      });
      await store.unset({ keys: ['k'], meta: undefined });

      time.advanceTo(Number.MAX_SAFE_INTEGER);

      expect(await versionOf(store, 'k')).toBe(1);
    });
  });

  describe('unset', () => {
    it('removes the named keys and keeps the rest', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      await put(store, 'a', 'A');
      await put(store, 'b', 'B');
      await put(store, 'c', 'C');

      await store.unset({ keys: ['a', 'c'], meta: undefined });

      expect(await storedValue(store, 'a')).toBeUndefined();
      expect(await storedValue(store, 'b')).toBe('B');
      expect(await storedValue(store, 'c')).toBeUndefined();
    });

    it('does nothing when neither keys nor meta is given', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      await put(store, 'a', 'A');

      await store.unset({ keys: undefined, meta: undefined });

      expect(await store.get({ key: 'a', meta: undefined })).toMatchObject({
        version: 0,
        data: { empty: false, value: 'A' },
      });
    });

    it.each([
      ['an object', { tags: ['users'] }],
      ['null', null],
    ])('rejects when meta is %s, and changes nothing', async (_label, meta) => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      await put(store, 'a', 'A');

      await expect(store.unset({ keys: ['a'], meta })).rejects.toMatchObject({
        code: 'RUNTIME.CACHE_STORE_META_UNSUPPORTED',
      });
      expect(await store.get({ key: 'a', meta: undefined })).toMatchObject({
        version: 0,
        data: { empty: false, value: 'A' },
      });
    });
  });

  describe('LRU eviction at maxEntries', () => {
    it('evicts the least recently used value once maxEntries is exceeded', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>({ maxEntries: 2 });
      await put(store, 'a', 'A');
      await put(store, 'b', 'B');
      await put(store, 'c', 'C');

      expect(await storedValue(store, 'a')).toBeUndefined();
      expect(await storedValue(store, 'b')).toBe('B');
      expect(await storedValue(store, 'c')).toBe('C');
    });

    it('counts a get as a use', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>({ maxEntries: 2 });
      await put(store, 'a', 'A');
      await put(store, 'b', 'B');
      await store.get({ key: 'a', meta: undefined });

      await put(store, 'c', 'C');

      expect(await storedValue(store, 'a')).toBe('A');
      expect(await storedValue(store, 'b')).toBeUndefined();
    });

    it('keeps 1000 values by default', async () => {
      const store = createInMemoryCacheStore<unknown, unknown>();
      for (let i = 0; i <= 1000; i++) {
        await put(store, `k${i}`, i);
      }

      expect(await storedValue(store, 'k0')).toBeUndefined();
      expect(await storedValue(store, 'k1')).toBe(1);
      expect(await storedValue(store, 'k1000')).toBe(1000);
    });
  });

  describe('expiry', () => {
    it('expires a value once ttlMs has passed since set, on the injected clock', async () => {
      const time = controlledClock(1_000);
      const store = createInMemoryCacheStore<unknown, unknown>({ ttlMs: 500, clock: time.clock });
      await put(store, 'k', 1);

      time.advanceTo(1_499);
      expect(await storedValue(store, 'k')).toBe(1);

      time.advanceTo(1_500);
      expect(await storedValue(store, 'k')).toBeUndefined();
    });

    it('expires values after 60 seconds by default', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore<unknown, unknown>({ clock: time.clock });
      await put(store, 'k', 1);

      time.advanceTo(59_999);
      expect(await storedValue(store, 'k')).toBe(1);

      time.advanceTo(60_000);
      expect(await storedValue(store, 'k')).toBeUndefined();
    });

    it('never expires a value when ttlMs is Infinity', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore<unknown, unknown>({
        ttlMs: Number.POSITIVE_INFINITY,
        clock: time.clock,
      });
      await put(store, 'k', 1);

      time.advanceTo(Number.MAX_SAFE_INTEGER);

      expect(await storedValue(store, 'k')).toBe(1);
    });

    it('frees the slot of an expired value', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore<unknown, unknown>({
        maxEntries: 2,
        ttlMs: 100,
        clock: time.clock,
      });
      await put(store, 'old', 'old');
      time.advanceTo(50);
      await put(store, 'live', 'live');
      time.advanceTo(100);
      expect(await storedValue(store, 'old')).toBeUndefined();

      await put(store, 'new', 'new');

      expect(await storedValue(store, 'live')).toBe('live');
      expect(await storedValue(store, 'new')).toBe('new');
    });
  });
});
