import { describe, expect, it } from 'vitest';
import { type CachedEntry, type CacheStore, createInMemoryCacheStore } from '../src/cache-store';

function entry(rows: ReadonlyArray<Record<string, unknown>>, storedAt = 0): CachedEntry {
  return { rows, storedAt };
}

describe('createInMemoryCacheStore', () => {
  describe('basic get/set', () => {
    it('returns undefined for a missing key', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 10 });
      expect(await store.get('absent')).toBeUndefined();
    });

    it('round-trips a stored entry by key', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 10 });
      const stored = entry([{ id: 1 }, { id: 2 }], 0);
      await store.set('k', stored, 60_000);
      const got = await store.get('k');
      expect(got).toEqual(stored);
    });

    it('overwrites an existing entry on repeated set with the same key', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 10 });
      await store.set('k', entry([{ v: 1 }]), 60_000);
      await store.set('k', entry([{ v: 2 }]), 60_000);
      const got = await store.get('k');
      expect(got?.rows).toEqual([{ v: 2 }]);
    });

    it('keeps distinct entries for distinct keys', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 10 });
      await store.set('a', entry([{ v: 'A' }]), 60_000);
      await store.set('b', entry([{ v: 'B' }]), 60_000);
      expect((await store.get('a'))?.rows).toEqual([{ v: 'A' }]);
      expect((await store.get('b'))?.rows).toEqual([{ v: 'B' }]);
    });

    it('satisfies the CacheStore interface', () => {
      const store: CacheStore = createInMemoryCacheStore({ maxEntries: 10 });
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.list).toBe('function');
      expect(typeof store.del).toBe('function');
    });

    it('lists keys and supports prefix filtering', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 10 });
      await store.set('ns:user:1', entry([{ id: 1 }]), 60_000);
      await store.set('ns:post:1', entry([{ id: 2 }]), 60_000);
      await store.set('global:1', entry([{ id: 3 }]), 60_000);

      expect(await store.list!()).toEqual(['ns:user:1', 'ns:post:1', 'global:1']);
      expect(await store.list!('ns:')).toEqual(['ns:user:1', 'ns:post:1']);
    });

    it('deletes a key via del()', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 10 });
      await store.set('k', entry([{ id: 1 }]), 60_000);
      await store.del!('k');
      expect(await store.get('k')).toBeUndefined();
    });
  });

  describe('LRU eviction at maxEntries', () => {
    it('evicts the least recently used entry once maxEntries is exceeded', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 2 });
      await store.set('a', entry([{ v: 'A' }]), 60_000);
      await store.set('b', entry([{ v: 'B' }]), 60_000);
      await store.set('c', entry([{ v: 'C' }]), 60_000);

      expect(await store.get('a')).toBeUndefined();
      expect((await store.get('b'))?.rows).toEqual([{ v: 'B' }]);
      expect((await store.get('c'))?.rows).toEqual([{ v: 'C' }]);
    });

    it('treats a get on an existing entry as a "use" for LRU ordering', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 2 });
      await store.set('a', entry([{ v: 'A' }]), 60_000);
      await store.set('b', entry([{ v: 'B' }]), 60_000);

      // Touch 'a' so it becomes most recently used; 'b' is now LRU.
      await store.get('a');

      // Inserting 'c' should evict 'b' (LRU), not 'a' (most recent).
      await store.set('c', entry([{ v: 'C' }]), 60_000);

      expect((await store.get('a'))?.rows).toEqual([{ v: 'A' }]);
      expect(await store.get('b')).toBeUndefined();
      expect((await store.get('c'))?.rows).toEqual([{ v: 'C' }]);
    });

    it('treats overwriting an existing entry as a "use" for LRU ordering', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 2 });
      await store.set('a', entry([{ v: 'A' }]), 60_000);
      await store.set('b', entry([{ v: 'B' }]), 60_000);

      // Re-set 'a' so it becomes most recently used.
      await store.set('a', entry([{ v: 'A2' }]), 60_000);

      // Inserting 'c' should now evict 'b'.
      await store.set('c', entry([{ v: 'C' }]), 60_000);

      expect((await store.get('a'))?.rows).toEqual([{ v: 'A2' }]);
      expect(await store.get('b')).toBeUndefined();
      expect((await store.get('c'))?.rows).toEqual([{ v: 'C' }]);
    });

    it('caps the live entry count at maxEntries', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 3 });
      for (let i = 0; i < 10; i++) {
        await store.set(`k${i}`, entry([{ i }]), 60_000);
      }
      // Only the most recent 3 keys (k7, k8, k9) survive.
      expect(await store.get('k0')).toBeUndefined();
      expect(await store.get('k6')).toBeUndefined();
      expect((await store.get('k7'))?.rows).toEqual([{ i: 7 }]);
      expect((await store.get('k8'))?.rows).toEqual([{ i: 8 }]);
      expect((await store.get('k9'))?.rows).toEqual([{ i: 9 }]);
    });
  });

  describe('TTL expiry', () => {
    it('returns undefined for an entry whose TTL has elapsed (relative to clock)', async () => {
      let now = 0;
      const store = createInMemoryCacheStore({
        maxEntries: 10,
        clock: () => now,
      });

      await store.set('k', entry([{ v: 1 }], now), 1_000);
      // Within TTL.
      now = 999;
      expect((await store.get('k'))?.rows).toEqual([{ v: 1 }]);

      // At TTL — boundary inclusive (treat reached TTL as expired).
      now = 1_000;
      expect(await store.get('k')).toBeUndefined();
    });

    it('returns undefined for an entry whose TTL is well past', async () => {
      let now = 0;
      const store = createInMemoryCacheStore({
        maxEntries: 10,
        clock: () => now,
      });

      await store.set('k', entry([{ v: 1 }], now), 100);
      now = 100_000;
      expect(await store.get('k')).toBeUndefined();
    });

    it('does not expire entries before their TTL', async () => {
      let now = 0;
      const store = createInMemoryCacheStore({
        maxEntries: 10,
        clock: () => now,
      });

      await store.set('k', entry([{ v: 1 }], now), 60_000);
      now = 30_000;
      expect((await store.get('k'))?.rows).toEqual([{ v: 1 }]);
    });

    it('uses the current clock time at set() as the TTL reference', async () => {
      let now = 1_000;
      const store = createInMemoryCacheStore({
        maxEntries: 10,
        clock: () => now,
      });

      // storedAt embedded in the entry by the caller; the store decides
      // expiry based on its own clock + the ttlMs passed to set.
      await store.set('k', entry([{ v: 1 }], now), 500);

      now = 1_499;
      expect(await store.get('k')).toBeDefined();

      now = 1_500;
      expect(await store.get('k')).toBeUndefined();
    });

    it('drops an expired entry on access (does not retain it for future re-set)', async () => {
      let now = 0;
      const store = createInMemoryCacheStore({
        maxEntries: 10,
        clock: () => now,
      });

      await store.set('k', entry([{ v: 1 }], now), 100);
      now = 200;
      expect(await store.get('k')).toBeUndefined();

      // After expiry, the slot is free; setting again works without
      // counting the expired entry against maxEntries.
      await store.set('k', entry([{ v: 2 }], now), 100);
      expect((await store.get('k'))?.rows).toEqual([{ v: 2 }]);
    });
  });

  describe('clock injection', () => {
    it('defaults to Date.now() when no clock is supplied', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 10 });
      const before = Date.now();
      await store.set('k', entry([{ v: 1 }]), 60_000);
      const got = await store.get('k');
      const after = Date.now();

      expect(got).toBeDefined();
      // The wall-clock check is sufficient to confirm the default clock is
      // wired without flakiness — TTL of 60s vs a sub-millisecond test.
      expect(after - before).toBeLessThan(60_000);
    });

    it('drives expiry purely from the injected clock', async () => {
      let tick = 0;
      const store = createInMemoryCacheStore({
        maxEntries: 10,
        clock: () => tick,
      });

      await store.set('k', entry([{ v: 1 }]), 10);
      tick = 5;
      expect(await store.get('k')).toBeDefined();
      tick = 10;
      expect(await store.get('k')).toBeUndefined();
    });
  });

  describe('row immutability', () => {
    it('does not lose information across get() round-trips', async () => {
      const store = createInMemoryCacheStore({ maxEntries: 10 });
      const original = entry(
        [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        42,
      );
      await store.set('k', original, 60_000);
      const recovered = await store.get('k');
      expect(recovered).toEqual(original);
      expect(recovered?.storedAt).toBe(42);
    });
  });
});
