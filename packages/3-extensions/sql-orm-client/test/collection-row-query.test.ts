import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { describeCollectionRows, type RowQuery } from '../src/collection-dispatch';
import { createCollectionFor } from './collection-fixtures';

function source(rows: Record<string, unknown>[]) {
  return new AsyncIterableResult(
    (async function* () {
      yield* rows;
    })(),
  );
}

describe('collection row query', () => {
  it('separates decoded database rows from the complete mapped result', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    const query = describeCollectionRows<{ userId: number }>({
      context: collection.ctx.context,
      state: collection.select('userId').state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
    expectTypeOf(query).toEqualTypeOf<
      RowQuery<Record<string, unknown>, AsyncIterableResult<{ userId: number }>>
    >();
    const result = query.consume(source([{ user_id: 42 }]));
    expectTypeOf(result).toEqualTypeOf<AsyncIterableResult<{ userId: number }>>();
    expect(await result).toEqual([{ userId: 42 }]);
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
    const query = describeCollectionRows({
      context: collection.ctx.context,
      state: selected.state,
      tableName: collection.tableName,
      modelName: collection.modelName,
      namespaceId: 'public',
    });
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
    expect(runtime.executions).toEqual([]);
  });
});
