import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { Preparable } from '@internal/sql-relational-core/plan';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { describeCollectionRows } from '../src/collection-dispatch';
import * as collectionRuntime from '../src/collection-runtime';
import { createCollectionFor } from './collection-fixtures';

function source(rows: Record<string, unknown>[]) {
  return new AsyncIterableResult(
    (async function* () {
      yield* rows;
    })(),
  );
}

describe('collection row query', () => {
  afterEach(() => vi.restoreAllMocks());

  it('precomputes known but unselected bindings and decodes fresh cells after empty and null payloads', async () => {
    const { collection } = createCollectionFor('User');
    const selected = collection.select('name').include('posts', (posts) => posts.select('userId'));
    const context = collection.ctx.context;
    const codec = context.contractCodecs.forColumn('public', 'posts', 'views');
    if (!codec) throw new Error('Missing views codec');
    const decode = vi.spyOn(codec, 'decodeJson');
    const columns = vi.spyOn(context.contractCodecs, 'forColumn');
    const descriptors = vi.spyOn(context.codecDescriptors, 'codecRefForColumn');
    const query = describeCollectionRows({
      context,
      state: selected.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    expect(columns).toHaveBeenCalledWith('public', 'posts', 'views');
    const counts = [columns.mock.calls.length, descriptors.mock.calls.length];
    expect(await query.consume(source([]))).toEqual([]);
    expect(await query.consume(source([{ name: 'A', posts: null }]))).toEqual([
      { name: 'A', posts: [] },
    ]);
    expect(
      await query.consume(source([{ name: 'A', posts: [{ views: null, user_id: undefined }] }])),
    ).toEqual([{ name: 'A', posts: [{ views: null, userId: undefined }] }]);
    const raw = [{ name: 'A', posts: [{ user_id: 1, views: 2, custom: true }] }];
    const first = await query.consume(source(raw));
    const second = await query.consume(source(raw));
    expect(first).toEqual([{ name: 'A', posts: [{ userId: 1, views: 2, custom: true }] }]);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
    expect(raw).toEqual([{ name: 'A', posts: [{ user_id: 1, views: 2, custom: true }] }]);
    expect(decode).toHaveBeenCalledTimes(4);
    expect([columns.mock.calls.length, descriptors.mock.calls.length]).toEqual(counts);
  });

  it('stores binding failures without throwing for absent, null or undefined cells', async () => {
    const { collection } = createCollectionFor('User');
    const selected = collection.select('name').include('posts', (posts) => posts.select('title'));
    const context = collection.ctx.context;
    const original = context.contractCodecs.forColumn.bind(context.contractCodecs);
    const failure = new Error('binding unavailable');
    const columns = vi
      .spyOn(context.contractCodecs, 'forColumn')
      .mockImplementation((namespace, table, column) => {
        if (table === 'posts' && column === 'title') throw failure;
        return original(namespace, table, column);
      });
    const query = describeCollectionRows({
      context,
      state: selected.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    expect(columns).toHaveBeenCalledWith('public', 'posts', 'title');
    const count = columns.mock.calls.length;
    expect(
      await query.consume(source([{ name: 'A', posts: [{ title: null }, { title: undefined }] }])),
    ).toEqual([{ name: 'A', posts: [{ title: null }, { title: undefined }] }]);
    for (let invocation = 0; invocation < 2; invocation++) {
      await expect(
        query.consume(source([{ name: 'A', posts: [{ title: 'later' }] }])).toArray(),
      ).rejects.toBe(failure);
    }
    expect(columns).toHaveBeenCalledTimes(count);
  });

  it('retains decode failure wrapping and executes the codec again on every invocation', async () => {
    const { collection } = createCollectionFor('User');
    const selected = collection.select('name').include('posts', (posts) => posts.select('views'));
    const context = collection.ctx.context;
    const codec = context.contractCodecs.forColumn('public', 'posts', 'views');
    if (!codec) throw new Error('Missing views codec');
    const cause = new Error('bad cell');
    const decode = vi.spyOn(codec, 'decodeJson').mockImplementation(() => {
      throw cause;
    });
    const query = describeCollectionRows({
      context,
      state: selected.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    expect(decode).not.toHaveBeenCalled();
    for (let invocation = 0; invocation < 2; invocation++) {
      await expect(
        query.consume(source([{ name: 'A', posts: [{ views: 2 }] }])).toArray(),
      ).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        cause,
        details: { table: 'posts', column: 'views', codec: 'pg/int4@1' },
      });
    }
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('retains missing-binding passthrough outcomes without retrying resolution', async () => {
    const { collection } = createCollectionFor('User');
    const selected = collection.select('name').include('posts', (posts) => posts.select('title'));
    const context = collection.ctx.context;
    const original = context.contractCodecs.forColumn.bind(context.contractCodecs);
    const columns = vi
      .spyOn(context.contractCodecs, 'forColumn')
      .mockImplementation((namespace, table, column) =>
        table === 'posts' && column === 'title' ? undefined : original(namespace, table, column),
      );
    const query = describeCollectionRows({
      context,
      state: selected.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    const count = columns.mock.calls.length;
    for (let invocation = 0; invocation < 2; invocation++) {
      expect(await query.consume(source([{ name: 'A', posts: [{ title: 'raw' }] }]))).toEqual([
        { name: 'A', posts: [{ title: 'raw' }] },
      ]);
    }
    expect(columns).toHaveBeenCalledTimes(count);
  });

  it('resolves scalar metadata before consuming null and nonnull envelopes', async () => {
    const { collection } = createCollectionFor('User');
    const selected = collection.select('name').include('posts', (posts) => posts.count());
    const context = collection.ctx.context;
    const lookup = vi.spyOn(context.contractCodecs, 'forCodecRef');
    const query = describeCollectionRows({
      context,
      state: selected.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    expect(lookup).toHaveBeenCalledOnce();
    for (let invocation = 0; invocation < 2; invocation++) {
      expect(
        await query.consume(
          source([
            { name: 'A', posts: null },
            { name: 'B', posts: { value: null } },
            { name: 'C', posts: { value: 2 } },
          ]),
        ),
      ).toEqual([
        { name: 'A', posts: 0 },
        { name: 'B', posts: 0 },
        { name: 'C', posts: 2 },
      ]);
    }
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('defers scalar codec resolution failures until the scalar is reached, including null', async () => {
    const { collection } = createCollectionFor('User');
    const selected = collection.select('name').include('posts', (posts) => posts.count());
    const context = collection.ctx.context;
    const failure = new Error('aggregate codec unavailable');
    const lookup = vi.spyOn(context.contractCodecs, 'forCodecRef').mockImplementation(() => {
      throw failure;
    });
    const query = describeCollectionRows({
      context,
      state: selected.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    expect(lookup).toHaveBeenCalledOnce();
    expect(await query.consume(source([]))).toEqual([]);
    for (let invocation = 0; invocation < 2; invocation++) {
      await expect(query.consume(source([{ name: 'A', posts: null }])).toArray()).rejects.toBe(
        failure,
      );
    }
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('separates decoded database rows from the complete mapped result', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    const mapper = vi.spyOn(collectionRuntime, 'createStorageRowMapper');
    const query = describeCollectionRows<{ userId: number }>({
      context: collection.ctx.context,
      state: collection.select('userId').state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    expectTypeOf(query).toEqualTypeOf<
      Preparable<Record<string, unknown>, AsyncIterableResult<{ userId: number }>>
    >();
    expect(mapper).toHaveBeenCalledTimes(1);
    const result = query.consume(source([{ user_id: 42 }]));
    expectTypeOf(result).toEqualTypeOf<AsyncIterableResult<{ userId: number }>>();
    expect(await result).toEqual([{ userId: 42 }]);
    expect(await query.consume(source([{ user_id: 43 }]))).toEqual([{ userId: 43 }]);
    expect(mapper).toHaveBeenCalledTimes(1);
    mapper.mockRestore();
    expect(runtime.executions).toEqual([]);
  });

  it('isolates interleaved include consumers and decodes nested row and scalar branches', async () => {
    const { collection, runtime } = createCollectionFor('User');
    const selected = collection.select('name').include('posts', (posts) =>
      posts.combine({
        rows: posts.select('userId').include('comments', (comments) => comments.select('postId')),
        count: posts.count(),
      }),
    );
    const context = collection.ctx.context;
    const forColumn = vi.spyOn(context.contractCodecs, 'forColumn');
    const forCodecRef = vi.spyOn(context.contractCodecs, 'forCodecRef');
    const mapper = vi.spyOn(collectionRuntime, 'createStorageRowMapper');
    const query = describeCollectionRows({
      context: collection.ctx.context,
      state: selected.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    expect(forColumn).toHaveBeenCalledWith('public', 'posts', 'user_id');
    expect(forColumn).toHaveBeenCalledWith('public', 'comments', 'post_id');
    expect(mapper).toHaveBeenCalledTimes(3);
    const columnCalls = forColumn.mock.calls.length;
    const scalarCalls = forCodecRef.mock.calls.length;
    expect(scalarCalls).toBeGreaterThan(0);
    const first = query
      .consume(
        source([
          {
            name: 'Alice',
            posts: { rows: [{ user_id: 1, comments: [{ post_id: 10 }] }], count: { value: 1 } },
          },
          { name: 'Bob', posts: { rows: [], count: { value: 0 } } },
        ]),
      )
      [Symbol.asyncIterator]();
    const second = query
      .consume(
        source([
          { name: 'Cara', posts: { rows: [{ user_id: 3, comments: [] }], count: { value: 1 } } },
        ]),
      )
      [Symbol.asyncIterator]();
    expect(await first.next()).toEqual({
      done: false,
      value: {
        name: 'Alice',
        posts: { rows: [{ userId: 1, comments: [{ postId: 10 }] }], count: 1 },
      },
    });
    expect(await second.next()).toEqual({
      done: false,
      value: { name: 'Cara', posts: { rows: [{ userId: 3, comments: [] }], count: 1 } },
    });
    expect(await first.next()).toEqual({
      done: false,
      value: { name: 'Bob', posts: { rows: [], count: 0 } },
    });
    expect(await second.next()).toEqual({ done: true, value: undefined });
    expect(await first.next()).toEqual({ done: true, value: undefined });
    expect(forColumn).toHaveBeenCalledTimes(columnCalls);
    expect(forCodecRef).toHaveBeenCalledTimes(scalarCalls);
    expect(mapper).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
    expect(runtime.executions).toEqual([]);
  });
});
