import { describe, expect, it } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware } from '../src/cache-middleware';
import type { CachedValue, CacheStore } from '../src/cache-store';
import { endCall, makeCall, makeCtx } from './middleware-fixtures';

interface Serializer {
  serialize(value: CachedValue): string;
  deserialize(text: string): CachedValue;
}

const dateAndBigintSerializer: Serializer = {
  serialize: (value) =>
    JSON.stringify(value, function (key, entry) {
      const original: unknown = this[key];
      if (original instanceof Date) return { $date: original.toISOString() };
      if (typeof entry === 'bigint') return { $bigint: entry.toString() };
      return entry;
    }),
  deserialize: (text) =>
    JSON.parse(text, (_key, entry) => {
      if (typeof entry === 'object' && entry !== null) {
        if (typeof entry.$date === 'string') return new Date(entry.$date);
        if (typeof entry.$bigint === 'string') return BigInt(entry.$bigint);
      }
      return entry;
    }),
};

function serializingStore(
  serializer: Serializer,
): CacheStore & { readonly texts: Map<string, string> } {
  const texts = new Map<string, string>();
  return {
    texts,
    async get({ key, meta }) {
      const text = texts.get(key);
      return {
        key,
        meta,
        version: 0,
        data:
          text === undefined
            ? { empty: true }
            : { empty: false, value: serializer.deserialize(text) },
      };
    },
    async set(entry, value) {
      texts.set(entry.key, serializer.serialize(value));
      return true;
    },
    async unset({ keys }) {
      for (const key of keys ?? []) texts.delete(key);
    },
  };
}

describe('createCacheMiddleware — a store that serializes values', () => {
  it('round-trips a call result holding a Date and a bigint through an application serializer', async () => {
    const store = serializingStore(dateAndBigintSerializer);
    const mw = createCacheMiddleware({ store });
    const annotated = { cache: cacheAnnotation({ key: 'user-1' }) };
    const result = { id: 9007199254740993n, createdAt: new Date('2026-01-02T03:04:05.000Z') };
    const call = makeCall(annotated);
    const ctx = makeCtx();

    await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, { result });
    const served = await mw.intercept!.onActivity!(makeCall(annotated), makeCtx());

    expect({ stored: typeof store.texts.get('user-1'), served }).toEqual({
      stored: 'string',
      served: { result },
    });
    expect(served?.result).not.toBe(result);
  });
});
