import { describe, expect, it } from 'vitest';
import { type CachedValue, type CacheStore, createInMemoryCacheStore } from '../src/cache-store';

function controlledClock(start = 0) {
  let now = start;
  return {
    clock: () => now,
    advanceTo(time: number) {
      now = time;
    },
  };
}

async function put(store: CacheStore, key: string, value: CachedValue) {
  return store.set(await store.get({ key, meta: undefined }), value);
}

async function putResult<T>(store: CacheStore, key: string, result: T) {
  return put(store, key, { kind: 'call-result', result });
}

async function storedValue(store: CacheStore, key: string) {
  const { data } = await store.get({ key, meta: undefined });
  return data.empty ? undefined : data.value;
}

async function storedResult<T>(store: CacheStore, key: string): Promise<T | undefined> {
  const value = await storedValue(store, key);
  return value?.kind === 'call-result' ? (value.result as T) : undefined;
}

async function versionOf(store: CacheStore, key: string) {
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
        createInMemoryCacheStore({
          ttlMs: Number.POSITIVE_INFINITY,
          maxEntries: 1,
        }),
      ).not.toThrow();
    });
  });

  describe('get and set', () => {
    it('returns an empty entry with version 0 for a key never seen, carrying the meta given', async () => {
      const store = createInMemoryCacheStore();

      expect(await store.get({ key: 'absent', meta: { tags: ['users'] } })).toEqual({
        key: 'absent',
        meta: { tags: ['users'] },
        version: 0,
        data: { empty: true },
      });
    });

    it('stores the value set on the entry get returned, and a later get returns it', async () => {
      const store = createInMemoryCacheStore();
      const entry = await store.get({ key: 'k', meta: undefined });

      expect(await store.set(entry, { kind: 'call-result', result: [{ id: 1 }, { id: 2 }] })).toBe(
        true,
      );

      expect(await store.get({ key: 'k', meta: undefined })).toEqual({
        key: 'k',
        meta: undefined,
        version: 0,
        data: { empty: false, value: { kind: 'call-result', result: [{ id: 1 }, { id: 2 }] } },
      });
    });

    it('round-trips any structured-cloneable value type', async () => {
      const store = createInMemoryCacheStore();
      const value = {
        n: 1,
        s: 'x',
        big: 2n,
        at: new Date(0),
        bytes: new Uint8Array([1, 2]),
        list: [null, { nested: true }],
        map: new Map([['a', new Set([1])]]),
      };

      await putResult(store, 'k', value);

      expect(await storedResult(store, 'k')).toEqual(value);
    });

    it('holds a copy, so mutating the stored value or a returned value changes no later get', async () => {
      const store = createInMemoryCacheStore();
      const row = { id: 1 };
      await putResult(store, 'k', { rows: [row] });

      row.id = 2;
      const first = await storedResult<{ rows: { id: number }[] }>(store, 'k');
      for (const stored of first?.rows ?? []) stored.id = 3;
      const second = await storedResult(store, 'k');

      expect({ second, distinct: first !== second }).toEqual({
        second: { rows: [{ id: 1 }] },
        distinct: true,
      });
    });

    it.each([
      [
        'a class instance',
        new (class Money {
          readonly cents = 1;
        })(),
      ],
      ['a function', () => 1],
      ['an Error', new TypeError('x')],
      ['an Error subclass', new (class AppError extends Error {})('x')],
      [
        'a Temporal-like value',
        new (class Instant {
          get [Symbol.toStringTag]() {
            return 'Temporal.Instant';
          }
        })(),
      ],
    ])(
      'stores a value holding %s, copying its structure and sharing the instance',
      async (_name, shared) => {
        const store = createInMemoryCacheStore();
        const value = { outer: [{ inner: shared }], map: new Map([['k', shared]]) };

        const stored = await putResult(store, 'k', value);
        const held = await storedResult<typeof value>(store, 'k');

        expect({
          stored,
          newOuter:
            held !== value && held?.outer !== value.outer && held?.outer[0] !== value.outer[0],
          sharedInArray: held?.outer[0]?.inner === shared,
          sharedInMap: held?.map.get('k') === shared,
        }).toEqual({ stored: true, newOuter: true, sharedInArray: true, sharedInMap: true });
      },
    );

    it.each([
      ['a Buffer', () => Buffer.from([1, 2, 3]), Buffer],
      ['a Uint8Array', () => new Uint8Array([1, 2, 3]), Uint8Array],
    ])(
      'stores %s in a row and returns an equal copy of the same class',
      async (_name, make, Class) => {
        const store = createInMemoryCacheStore();
        const bytes = make();
        await putResult(store, 'k', { rows: [{ bytes }] });

        const held = (await storedResult<{ rows: { bytes: Uint8Array }[] }>(store, 'k'))?.rows[0]
          ?.bytes;

        expect({
          sameClass: held?.constructor === Class,
          equal: held !== undefined && [...held].join() === [...bytes].join(),
          sameObject: held === bytes,
          sameMemory: held?.buffer === bytes.buffer,
        }).toEqual({ sameClass: true, equal: true, sameObject: false, sameMemory: false });
      },
    );

    it('stores a DataView and returns a copy of its bytes', async () => {
      const store = createInMemoryCacheStore();
      const view = new DataView(new Uint8Array([9, 8, 7, 6]).buffer, 1, 2);
      await putResult(store, 'k', { view });

      const held = (await storedResult<{ view: DataView }>(store, 'k'))?.view;

      expect({
        bytes: held === undefined ? [] : [held.getUint8(0), held.getUint8(1)],
        sameMemory: held?.buffer === view.buffer,
      }).toEqual({ bytes: [8, 7], sameMemory: false });
    });

    it('keeps statement rows with their driver values by reference, copying the array and each row', async () => {
      class ObjectId {
        constructor(readonly hex: string) {}
      }
      const store = createInMemoryCacheStore();
      const id = new ObjectId('abc');
      const row = { _id: id, name: 'Ada' };
      await put(store, 'k', { kind: 'statement-rows', rows: [row] });

      const first = await storedValue(store, 'k');
      const second = await storedValue(store, 'k');
      const rowOf = (value: typeof first) =>
        value?.kind === 'statement-rows' ? value.rows[0] : undefined;

      expect({
        stored: first,
        rowCopied: rowOf(first) !== row,
        rowsCopiedPerGet: rowOf(first) !== rowOf(second),
        driverValueKept: rowOf(first)?.['_id'] === id,
      }).toEqual({
        stored: { kind: 'statement-rows', rows: [{ _id: id, name: 'Ada' }] },
        rowCopied: true,
        rowsCopiedPerGet: true,
        driverValueKept: true,
      });
    });

    it('keeps the prototype of each statement row it copies', async () => {
      const store = createInMemoryCacheStore();
      const row: Record<string, unknown> = Object.assign(Object.create(null), { id: 1 });
      await put(store, 'k', { kind: 'statement-rows', rows: [row] });

      const held = await storedValue(store, 'k');
      const copy = held?.kind === 'statement-rows' ? held.rows[0] : undefined;

      expect({
        copied: copy !== undefined && copy !== row,
        prototype: copy === undefined ? 'missing' : Object.getPrototypeOf(copy),
        id: copy?.['id'],
      }).toEqual({ copied: true, prototype: null, id: 1 });
    });

    it('copies an array as its elements only, with holes read as undefined', async () => {
      const store = createInMemoryCacheStore();
      const list: unknown[] = [1];
      list[2] = 3;
      Object.assign(list, { extra: true });
      await put(store, 'k', { kind: 'call-result', result: list });

      const held = await storedValue(store, 'k');

      expect(held).toEqual({ kind: 'call-result', result: [1, undefined, 3] });
    });

    it('stores a value that refers to the same object twice or to itself', async () => {
      const store = createInMemoryCacheStore();
      const shared = { id: 1 };
      const cyclic: Record<string, unknown> = { a: shared, b: shared };
      cyclic['self'] = cyclic;

      expect(await putResult(store, 'k', cyclic)).toBe(true);
    });

    it('overwrites a value through a set on the non-empty entry get returned', async () => {
      const store = createInMemoryCacheStore();
      await putResult(store, 'k', 1);

      expect(await putResult(store, 'k', 2)).toBe(true);

      expect(await storedResult(store, 'k')).toBe(2);
    });

    it('ignores meta in get and set', async () => {
      const store = createInMemoryCacheStore();
      await store.set(await store.get({ key: 'k', meta: { tags: ['users'] } }), {
        kind: 'call-result',
        result: 1,
      });

      expect(await store.get({ key: 'k', meta: { tags: ['posts'] } })).toEqual({
        key: 'k',
        meta: { tags: ['posts'] },
        version: 0,
        data: { empty: false, value: { kind: 'call-result', result: 1 } },
      });
    });
  });

  describe('versions', () => {
    it('does not change the version on set', async () => {
      const store = createInMemoryCacheStore();
      await store.unset({ keys: ['k'], meta: undefined });

      await putResult(store, 'k', 1);

      expect(await versionOf(store, 'k')).toBe(1);
    });

    it('stores nothing and returns false when the version moved after get', async () => {
      const store = createInMemoryCacheStore();
      const entry = await store.get({ key: 'k', meta: undefined });
      await store.unset({ keys: ['k'], meta: undefined });

      expect(await store.set(entry, { kind: 'call-result', result: 1 })).toBe(false);

      expect(await storedResult(store, 'k')).toBeUndefined();
    });

    it('refuses a refresh on a non-empty entry whose version moved', async () => {
      const store = createInMemoryCacheStore();
      await putResult(store, 'k', 1);
      const entry = await store.get({ key: 'k', meta: undefined });
      await store.unset({ keys: ['k'], meta: undefined });

      expect(await store.set(entry, { kind: 'call-result', result: 2 })).toBe(false);
      expect(await storedResult(store, 'k')).toBeUndefined();
    });

    it('increments the version of a key unset removes', async () => {
      const store = createInMemoryCacheStore();
      await putResult(store, 'k', 1);

      await store.unset({ keys: ['k'], meta: undefined });

      expect(await store.get({ key: 'k', meta: undefined })).toEqual({
        key: 'k',
        meta: undefined,
        version: 1,
        data: { empty: true },
      });
    });

    it('increments the version of a key unset names that holds no value', async () => {
      const store = createInMemoryCacheStore();

      await store.unset({ keys: ['absent'], meta: undefined });
      await store.unset({ keys: ['absent'], meta: undefined });

      expect(await versionOf(store, 'absent')).toBe(2);
    });

    it('forgets the version of a key ttlMs after the unset that set it', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore({ ttlMs: 100, clock: time.clock });
      await store.unset({ keys: ['k'], meta: undefined });

      time.advanceTo(99);
      expect(await versionOf(store, 'k')).toBe(1);

      time.advanceTo(100);
      expect(await versionOf(store, 'k')).toBe(0);
    });

    it('keeps the versions of other keys when one key is invalidated again', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore({ ttlMs: 100, clock: time.clock });
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
      const store = createInMemoryCacheStore({
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
      const store = createInMemoryCacheStore();
      await putResult(store, 'a', 'A');
      await putResult(store, 'b', 'B');
      await putResult(store, 'c', 'C');

      await store.unset({ keys: ['a', 'c'], meta: undefined });

      expect(await storedResult(store, 'a')).toBeUndefined();
      expect(await storedResult(store, 'b')).toBe('B');
      expect(await storedResult(store, 'c')).toBeUndefined();
    });

    it('does nothing when neither keys nor meta is given', async () => {
      const store = createInMemoryCacheStore();
      await putResult(store, 'a', 'A');

      await store.unset({ keys: undefined, meta: undefined });

      expect(await store.get({ key: 'a', meta: undefined })).toMatchObject({
        version: 0,
        data: { empty: false, value: { kind: 'call-result', result: 'A' } },
      });
    });

    it.each([
      ['an object', { tags: ['users'] }],
      ['null', null],
    ])('rejects when meta is %s, and changes nothing', async (_label, meta) => {
      const store = createInMemoryCacheStore();
      await putResult(store, 'a', 'A');

      await expect(store.unset({ keys: ['a'], meta })).rejects.toMatchObject({
        code: 'RUNTIME.CACHE_STORE_META_UNSUPPORTED',
      });
      expect(await store.get({ key: 'a', meta: undefined })).toMatchObject({
        version: 0,
        data: { empty: false, value: { kind: 'call-result', result: 'A' } },
      });
    });
  });

  describe('LRU eviction at maxEntries', () => {
    it('evicts the least recently used value once maxEntries is exceeded', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 2 });
      await putResult(store, 'a', 'A');
      await putResult(store, 'b', 'B');
      await putResult(store, 'c', 'C');

      expect(await storedResult(store, 'a')).toBeUndefined();
      expect(await storedResult(store, 'b')).toBe('B');
      expect(await storedResult(store, 'c')).toBe('C');
    });

    it('counts a get as a use', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 2 });
      await putResult(store, 'a', 'A');
      await putResult(store, 'b', 'B');
      await store.get({ key: 'a', meta: undefined });

      await putResult(store, 'c', 'C');

      expect(await storedResult(store, 'a')).toBe('A');
      expect(await storedResult(store, 'b')).toBeUndefined();
    });

    it('keeps 1000 values by default', async () => {
      const store = createInMemoryCacheStore();
      for (let i = 0; i <= 1000; i++) {
        await putResult(store, `k${i}`, i);
      }

      expect(await storedResult(store, 'k0')).toBeUndefined();
      expect(await storedResult(store, 'k1')).toBe(1);
      expect(await storedResult(store, 'k1000')).toBe(1000);
    });
  });

  describe('expiry', () => {
    it('expires a value once ttlMs has passed since set, on the injected clock', async () => {
      const time = controlledClock(1_000);
      const store = createInMemoryCacheStore({ ttlMs: 500, clock: time.clock });
      await putResult(store, 'k', 1);

      time.advanceTo(1_499);
      expect(await storedResult(store, 'k')).toBe(1);

      time.advanceTo(1_500);
      expect(await storedResult(store, 'k')).toBeUndefined();
    });

    it('expires values after 60 seconds by default', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore({ clock: time.clock });
      await putResult(store, 'k', 1);

      time.advanceTo(59_999);
      expect(await storedResult(store, 'k')).toBe(1);

      time.advanceTo(60_000);
      expect(await storedResult(store, 'k')).toBeUndefined();
    });

    it('never expires a value when ttlMs is Infinity', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore({
        ttlMs: Number.POSITIVE_INFINITY,
        clock: time.clock,
      });
      await putResult(store, 'k', 1);

      time.advanceTo(Number.MAX_SAFE_INTEGER);

      expect(await storedResult(store, 'k')).toBe(1);
    });

    it('frees the slot of an expired value', async () => {
      const time = controlledClock();
      const store = createInMemoryCacheStore({
        maxEntries: 2,
        ttlMs: 100,
        clock: time.clock,
      });
      await putResult(store, 'old', 'old');
      time.advanceTo(50);
      await putResult(store, 'live', 'live');
      time.advanceTo(100);
      expect(await storedResult(store, 'old')).toBeUndefined();

      await putResult(store, 'new', 'new');

      expect(await storedResult(store, 'live')).toBe('live');
      expect(await storedResult(store, 'new')).toBe('new');
    });
  });
});
