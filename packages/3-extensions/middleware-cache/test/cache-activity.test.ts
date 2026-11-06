import { describe, expect, it, vi } from 'vitest';
import { cacheAnnotation } from '../src/cache-annotation';
import { createCacheMiddleware } from '../src/cache-middleware';
import { createInMemoryCacheStore } from '../src/cache-store';
import {
  endCall,
  endStatement,
  makeCall,
  makeCtx,
  makeExec,
  runMiss,
  spyStore,
} from './middleware-fixtures';

const annotated = { cache: cacheAnnotation({}) };

describe('createCacheMiddleware — client activities such as ORM calls', () => {
  it('stores the result of an annotated call that succeeded, keyed by its content hash', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const call = makeCall(annotated);
    const ctx = makeCtx();

    const intercepted = await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, { result: [{ id: 1 }] });

    expect({ intercepted, stored: store.inner.get('call-hash') }).toEqual({
      intercepted: undefined,
      stored: { kind: 'call-result', result: [{ id: 1 }] },
    });
  });

  it('serves a stored result on the next call', async () => {
    const store = spyStore();
    store.inner.set('call-hash', { kind: 'call-result', result: { id: 1 } });
    const mw = createCacheMiddleware({ store });

    expect(await mw.intercept!.onActivity!(makeCall(annotated), makeCtx())).toEqual({
      result: { id: 1 },
    });
  });

  it('stores and serves null, which is a result', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const call = makeCall(annotated);
    const ctx = makeCtx();

    await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, { result: null });

    expect(await mw.intercept!.onActivity!(makeCall(annotated), makeCtx())).toEqual({
      result: null,
    });
  });

  it('keys on the annotation key, without computing the content hash', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const contentHash = vi.fn(async () => 'call-hash');
    const call = makeCall({ cache: cacheAnnotation({ key: 'user-1' }) }, contentHash);
    const ctx = makeCtx();

    await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, { result: { id: 1 } });

    expect({ hashed: contentHash.mock.calls.length, keys: [...store.inner.keys()] }).toEqual({
      hashed: 0,
      keys: ['user-1'],
    });
  });

  it.each([
    ['failed', { outcome: 'failed' as const }],
    ['stopped', { outcome: 'stopped' as const, result: [{ id: 1 }] }],
    ['succeeded without a result', {}],
  ])('stores nothing for a call that ended %s', async (_name, ended) => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });
    const call = makeCall(annotated);
    const ctx = makeCtx();

    await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, ended);

    expect(store.setSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['inside a transaction', makeCtx({ inTransaction: () => true })],
    ['on a held connection', makeCtx({ scope: 'connection' })],
  ])('neither serves nor stores a call %s', async (_name, ctx) => {
    const store = spyStore();
    store.inner.set('call-hash', { kind: 'call-result', result: { id: 1 } });
    const mw = createCacheMiddleware({ store });
    const call = makeCall(annotated);

    const intercepted = await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, { result: { id: 2 } });

    expect({
      intercepted,
      gets: store.getSpy.mock.calls.length,
      sets: store.setSpy.mock.calls.length,
    }).toEqual({
      intercepted: undefined,
      gets: 0,
      sets: 0,
    });
  });

  it('ignores an unannotated or bypassed call', async () => {
    const store = spyStore();
    const mw = createCacheMiddleware({ store });

    await mw.intercept!.onActivity!(makeCall(), makeCtx());
    await mw.intercept!.onActivity!(
      makeCall({ cache: cacheAnnotation({ bypass: true }) }),
      makeCtx(),
    );

    expect(store.getSpy).not.toHaveBeenCalled();
  });
});

describe('createCacheMiddleware — statement rows and call results under one key', () => {
  it('misses a call when the key holds statement rows, and stores the call result in their place', async () => {
    const store = spyStore();
    store.setRows('shared', [{ id: 1 }]);
    const debug = vi.fn();
    const mw = createCacheMiddleware({ store });
    const call = makeCall({ cache: cacheAnnotation({ key: 'shared' }) });
    const ctx = makeCtx({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug } });

    const intercepted = await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, { result: { id: 2 } });

    expect({
      intercepted,
      events: debug.mock.calls.map(([event]) => event.event),
      stored: store.inner.get('shared'),
    }).toEqual({
      intercepted: undefined,
      events: ['middleware.cache.miss', 'middleware.cache.store'],
      stored: { kind: 'call-result', result: { id: 2 } },
    });
  });

  it('misses a statement when the key holds a call result, and stores the rows in its place', async () => {
    const store = spyStore();
    store.inner.set('shared', { kind: 'call-result', result: [{ id: 1 }] });
    const debug = vi.fn();
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', { cache: cacheAnnotation({ key: 'shared' }) });
    const ctx = makeCtx({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug } });

    const intercepted = await mw.intercept!.onQuery!(exec, ctx);
    await mw.onRow!({ id: 2 }, exec, ctx);
    await endStatement(mw, exec, ctx, { rowCount: 1 });

    expect({
      intercepted,
      events: debug.mock.calls.map(([event]) => event.event),
      stored: store.inner.get('shared'),
    }).toEqual({
      intercepted: undefined,
      events: ['middleware.cache.miss', 'middleware.cache.store'],
      stored: { kind: 'statement-rows', rows: [{ id: 2 }] },
    });
  });

  it('neither serves nor stores an annotated statement inside a transaction', async () => {
    const store = spyStore();
    store.setRows('key:select 1', [{ id: 1 }]);
    const mw = createCacheMiddleware({ store });
    const exec = makeExec('select 1', annotated);
    const ctx = makeCtx({ inTransaction: () => true });

    const intercepted = await mw.intercept!.onQuery!(exec, ctx);
    await runMiss(mw, makeExec('select 2', annotated), makeCtx({ inTransaction: () => true }), [
      { id: 2 },
    ]);

    expect({ intercepted, sets: store.setSpy.mock.calls.length }).toEqual({
      intercepted: undefined,
      sets: 0,
    });
  });
});

describe('createCacheMiddleware — a call that overlaps an invalidate', () => {
  it('does not store the result of a call that missed before an invalidate of its key', async () => {
    const store = spyStore();
    const debug = vi.fn();
    const mw = createCacheMiddleware({ store });
    const call = makeCall({ cache: cacheAnnotation({ key: 'user-1' }) });
    const ctx = makeCtx({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug } });

    await mw.intercept!.onActivity!(call, ctx);
    await mw.invalidate({ keys: ['user-1'] });
    await endCall(mw, call, ctx, { result: { id: 1 } });

    expect({
      stored: store.inner.get('user-1'),
      skipped: debug.mock.calls.some(
        ([event]) => event.event === 'middleware.cache.store-skipped' && event.key === 'user-1',
      ),
    }).toEqual({ stored: undefined, skipped: true });
  });
});

describe('createCacheMiddleware — the default store copies call results', () => {
  async function missThenStore(
    mw: ReturnType<typeof createCacheMiddleware>,
    result: unknown,
  ): Promise<void> {
    const call = makeCall(annotated);
    const ctx = makeCtx();
    await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, { result });
  }

  async function hit(mw: ReturnType<typeof createCacheMiddleware>) {
    return mw.intercept!.onActivity!(makeCall(annotated), makeCtx());
  }

  it('keeps a hit unchanged when the first caller or an earlier hit mutates its result', async () => {
    const mw = createCacheMiddleware({ store: createInMemoryCacheStore() });
    const alice = { id: 1, name: 'Alice' };

    await missThenStore(mw, [alice]);
    alice.name = 'changed by the first caller';
    const second = await hit(mw);
    for (const row of (second?.result ?? []) as { name: string }[]) row.name = 'changed by a hit';
    const third = await hit(mw);

    expect({ second: second?.result, third: third?.result }).toEqual({
      second: [{ id: 1, name: 'changed by a hit' }],
      third: [{ id: 1, name: 'Alice' }],
    });
  });

  it('stores a result holding a class instance, and a hit returns a new outer object sharing the instance', async () => {
    class Money {
      readonly cents = 100;
    }
    const mw = createCacheMiddleware({ store: createInMemoryCacheStore() });
    const price = new Money();
    const first = { price };

    await missThenStore(mw, first);
    const served = (await hit(mw))?.result as { price: Money } | undefined;

    expect({
      newOuter: served !== undefined && served !== first,
      shared: served?.price === price,
    }).toEqual({
      newOuter: true,
      shared: true,
    });
  });
});

describe('createCacheMiddleware — the default store copies statement rows', () => {
  it('serves a row holding a Buffer, in a row object that is not the stored one', async () => {
    const mw = createCacheMiddleware({ store: createInMemoryCacheStore() });
    const exec = makeExec('select bytes', annotated);
    const bytes = Buffer.from([1, 2, 3]);
    const stored = { bytes };

    await runMiss(mw, exec, makeCtx(), [stored]);
    const hit = await mw.intercept!.onQuery!(exec, makeCtx());
    const [row] = [...((hit?.rows ?? []) as Iterable<{ bytes: Buffer }>)];

    expect({
      isBuffer: Buffer.isBuffer(row?.bytes),
      equal: row?.bytes.equals(bytes),
      sameRow: row === stored,
    }).toEqual({ isBuffer: true, equal: true, sameRow: false });
  });
});

describe('createCacheMiddleware — statement rows with driver class instances', () => {
  it('stores and serves a row holding a class instance, in a row object that is not the stored one', async () => {
    class ObjectId {
      constructor(readonly hex: string) {}
    }
    const mw = createCacheMiddleware({ store: createInMemoryCacheStore() });
    const exec = makeExec('find users', annotated);
    const row = { _id: new ObjectId('abc') };

    await runMiss(mw, exec, makeCtx(), [row]);
    const hit = await mw.intercept!.onQuery!(exec, makeCtx());
    const [served] = [...((hit?.rows ?? []) as Iterable<{ _id: ObjectId }>)];

    expect({ id: served?._id, sameRow: served === row }).toEqual({ id: row._id, sameRow: false });
  });

  it('stores a call result holding an Error, sharing the Error', async () => {
    const mw = createCacheMiddleware({ store: createInMemoryCacheStore() });
    const call = makeCall(annotated);
    const ctx = makeCtx();
    const failure = new Error('x');

    await mw.intercept!.onActivity!(call, ctx);
    await endCall(mw, call, ctx, { result: { failure } });
    const served = await mw.intercept!.onActivity!(makeCall(annotated), makeCtx());

    expect((served?.result as { failure: Error } | undefined)?.failure).toBe(failure);
  });
});
