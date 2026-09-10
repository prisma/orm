import {
  AsyncIterableResult,
  defineAnnotation,
  type MetaBuilder,
} from '@internal/framework-components/runtime';
import type { PreparedStatement } from '@internal/sql-runtime';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Collection } from '../src/collection';
import type { RowQuery } from '../src/collection-dispatch';
import { createPreparedRowQuery } from '../src/prepared-row-query';
import { createCollectionFor } from './collection-fixtures';
import { buildStiPolyContract, createMockRuntime, getTestContext, isSelectAst } from './helpers';

function source<Row>(rows: Row[]) {
  return new AsyncIterableResult(
    (async function* () {
      yield* rows;
    })(),
  );
}

function prepareRows<Result>(
  description: RowQuery<Record<string, unknown>, Result>,
  rows: (id: number) => Record<string, unknown>[],
) {
  const statement: PreparedStatement<{ id: number }, Record<string, unknown>> = {
    sql: 'select rows',
    ast: description.plan.ast,
    meta: description.plan.meta,
    slots: [],
    query: (_target, params) => source(rows(params.id)),
  };
  return createPreparedRowQuery(description, statement);
}

const annotation = defineAnnotation<{ label: string }>()({
  namespace: 'prepared-test',
  applicableTo: ['read'],
});

describe('prepared collection', () => {
  it('preserves all and first annotations without changing the source or ordinary terminals', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    const selected = collection.where({ id: 7 }).select('userId').limit(99);
    const configure = (meta: MetaBuilder<'read'>) =>
      meta.annotate(annotation({ label: 'prepared' }));
    const all = selected.prepared.all(configure);
    const first = selected.prepared.first(undefined, configure);
    expect(annotation.read(all.plan)).toEqual({ label: 'prepared' });
    expect(annotation.read(first.plan)).toEqual({ label: 'prepared' });
    expect(annotation.read(selected.prepared.all().plan)).toBeUndefined();
    runtime.setNextResults([[{ user_id: 2 }], [{ user_id: 3 }]]);
    expect(await selected.all(configure)).toEqual([{ userId: 2 }]);
    expect(await selected.first(undefined, configure)).toEqual({ userId: 3 });
    expect(runtime.executions.map(({ plan }) => annotation.read(plan))).toEqual([
      { label: 'prepared' },
      { label: 'prepared' },
    ]);
    expect(runtime.executions.map(({ plan }) => plan.params)).toEqual([
      all.plan.params,
      first.plan.params,
    ]);
    expect(selected.state.limit).toBe(99);
  });

  it('isolates interleaved prepared include buffers and nested scalar branches', async () => {
    const { collection, runtime } = createCollectionFor('User');
    const description = collection
      .select('name')
      .include('posts', (posts) =>
        posts.combine({ rows: posts.select('userId'), count: posts.count() }),
      )
      .prepared.all();
    const prepared = prepareRows(description, (id) => [
      { name: `User ${id}`, posts: { rows: [{ user_id: id }], count: { value: 1 } } },
      { name: `Empty ${id}`, posts: { rows: [], count: { value: 0 } } },
    ]);
    const a = prepared.query(runtime, { id: 1 })[Symbol.asyncIterator]();
    const b = prepared.query(runtime, { id: 9 })[Symbol.asyncIterator]();
    expect(await Promise.all([a.next(), b.next()])).toEqual([
      { done: false, value: { name: 'User 1', posts: { rows: [{ userId: 1 }], count: 1 } } },
      { done: false, value: { name: 'User 9', posts: { rows: [{ userId: 9 }], count: 1 } } },
    ]);
    expect(await b.next()).toEqual({
      done: false,
      value: { name: 'Empty 9', posts: { rows: [], count: 0 } },
    });
    expect(await a.next()).toEqual({
      done: false,
      value: { name: 'Empty 1', posts: { rows: [], count: 0 } },
    });
    expect(await Promise.all([a.next(), b.next()])).toEqual([
      { done: true, value: undefined },
      { done: true, value: undefined },
    ]);
    expect(runtime.executions).toEqual([]);
  });

  it('maps selected variant fields through the same prepared row consumer', async () => {
    const runtime = createMockRuntime();
    const context = { ...getTestContext(), contract: buildStiPolyContract() };
    const collection = new Collection({ runtime, context }, 'User', { namespaceId: 'public' });
    const selected = collection.variant('Admin' as never).select('name', 'role' as never);
    const prepared = prepareRows(selected.prepared.all(), () => [
      { name: 'Admin', kind: 'admin', role: 'owner', plan: null },
    ]);
    expect(await prepared.query(runtime, { id: 1 })).toEqual([
      { name: 'Admin', kind: 'admin', role: 'owner' },
    ]);
    expect(runtime.executions).toEqual([]);
  });
  it('describes selected reads synchronously without runtime access', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    const query = vi.spyOn(runtime, 'query');
    const view = collection.select('userId').prepared;
    expect(Object.keys(view)).toEqual(['all', 'first']);
    const all = view.all();
    const first = view.first();
    expect(all).not.toBeInstanceOf(Promise);
    expect(first).not.toBeInstanceOf(Promise);
    expectTypeOf(all.consume).returns.toEqualTypeOf<AsyncIterableResult<{ userId: number }>>();
    expectTypeOf(first.consume).returns.toEqualTypeOf<Promise<{ userId: number } | null>>();
    expect(await all.consume(source([{ user_id: 1 }]))).toEqual([{ userId: 1 }]);
    expect(await first.consume(source([{ user_id: 2 }]))).toEqual({ userId: 2 });
    expect(await first.consume(source([]))).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('first preserves filters and replaces an earlier limit', () => {
    const { collection } = createCollectionFor('Post');
    const selected = collection.select('userId').limit(99);
    const shorthand = selected.prepared.first({ id: 7 });
    const callback = selected.prepared.first((post) => post.id.eq(7));
    for (const description of [shorthand, callback]) {
      expect(isSelectAst(description.plan.ast)).toBe(true);
      if (!isSelectAst(description.plan.ast)) throw new Error('expected select');
      expect(description.plan.ast.limit).toBe(1);
      expect(description.plan.params).toEqual([7]);
    }
    const configure = vi.fn();
    selected.prepared.first(undefined, configure);
    expect(configure).toHaveBeenCalledOnce();
    expect(selected.state.limit).toBe(99);
  });

  it('wraps SQL rows without assimilating all and forwards the explicit target and options', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    const description = collection.select('userId').prepared.all();
    const events: string[] = [];
    const query = vi.fn(
      (_target, params: { id: number }, _options) =>
        new AsyncIterableResult(
          (async function* () {
            try {
              events.push('row');
              yield { user_id: params.id };
              events.push('second row');
              yield { user_id: params.id + 1 };
            } finally {
              events.push('closed');
            }
          })(),
        ),
    );
    const statement: PreparedStatement<{ id: number }, Record<string, unknown>> = {
      sql: 'select user_id from posts',
      ast: description.plan.ast,
      meta: description.plan.meta,
      slots: [],
      query,
    };
    const prepared = createPreparedRowQuery(description, statement);
    const options = {};
    const first = prepared.query(runtime, { id: 1 }, options);
    expectTypeOf(first).toEqualTypeOf<AsyncIterableResult<{ userId: number }>>();
    expect(first[Symbol.asyncIterator]).toBeTypeOf('function');
    expect(events).toEqual([]);
    for await (const row of first) {
      expect(row).toEqual({ userId: 1 });
      expect(events).toEqual(['row']);
      break;
    }
    expect(events).toEqual(['row', 'closed']);
    expect(query).toHaveBeenCalledWith(runtime, { id: 1 }, options);
    expect(await prepared.query(runtime, { id: 10 })).toEqual([{ userId: 10 }, { userId: 11 }]);
    const preparedFirst = createPreparedRowQuery(
      collection.select('userId').prepared.first(),
      statement,
    );
    expectTypeOf(preparedFirst.query(runtime, { id: 20 })).toEqualTypeOf<
      Promise<{ userId: number } | null>
    >();
    expect(await preparedFirst.query(runtime, { id: 20 })).toEqual({ userId: 20 });
  });
});
