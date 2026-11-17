import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { ColumnRef, PreparedParamRef } from '@internal/sql-relational-core/ast';
import type { Expression } from '@internal/sql-relational-core/expression';
import { expect, expectTypeOf, it, vi } from 'vitest';
import * as mapping from '../src/collection-runtime';
import { createCollectionFor } from './collection-fixtures';

function parameter<Id extends string, Nullable extends boolean>(
  id: Id,
  nullable: Nullable,
): Expression<{ codecId: Id; nullable: Nullable }> {
  return {
    returnType: { codecId: id, nullable },
    buildAst: () => PreparedParamRef.of('value', { codecId: id }, nullable),
  };
}
function rows(values: Record<string, unknown>[]) {
  return new AsyncIterableResult(
    (async function* () {
      yield* values;
    })(),
  );
}

it('captures grouped mapping and aliases once and returns fresh complete arrays', async () => {
  const { collection, runtime } = createCollectionFor('Post');
  const mapper = vi.spyOn(mapping, 'createStorageRowMapper');
  const selector = vi.fn((agg: Parameters<Parameters<typeof collection.aggregate>[0]>[0]) => ({
    total: agg.count(),
    user_id: agg.sum('views'),
  }));
  const configure = vi.fn();
  const grouped = collection.groupBy('userId');
  const description = grouped.prepared.aggregate(selector, configure);
  expectTypeOf(description.consume).returns.toEqualTypeOf<
    Promise<Array<{ userId: number; total: number; user_id: number | null }>>
  >();
  expect(runtime.executions).toEqual([]);
  expect(mapper).toHaveBeenCalledOnce();
  const [a, b] = await Promise.all([
    description.consume(rows([{ user_id: 2, total: 3 }])),
    description.consume(rows([{ user_id: 4, total: 5 }])),
  ]);
  expect(a).toEqual([{ userId: 2, user_id: 2, total: 3 }]);
  expect(b).toEqual([{ userId: 4, user_id: 4, total: 5 }]);
  const again = await description.consume(rows([{ user_id: 2, total: 3 }]));
  expect(again).toEqual(a);
  expect(again).not.toBe(a);
  expect(again[0]).not.toBe(a[0]);
  expect(await description.consume(rows([]))).toEqual([]);
  expect(mapper).toHaveBeenCalledOnce();
  expect(selector).toHaveBeenCalledOnce();
  expect(configure).toHaveBeenCalledOnce();
  runtime.setNextResults([[{ user_id: 2, total: 3 }]]);
  expect(await grouped.aggregate(selector, configure)).toEqual(a);
  expect(runtime.executions[0]?.plan).toEqual(description.plan);
  mapper.mockRestore();
});

it('constructs null-safe HAVING comparisons immediately and retains prepared pagination in its own stage', () => {
  const { collection } = createCollectionFor('Post');
  const nullable = parameter('pg/int8number@1', true);
  const page = parameter('pg/int4@1', false);
  const grouped = collection
    .limit(7)
    .groupBy('userId')
    .having((h) => h.count().eq(nullable))
    .orderBy((post) => post.userId.asc())
    .limit(page)
    .offset(page);
  expect(grouped.havingFilters[0]).toMatchObject({
    kind: 'binary',
    op: 'isNotDistinctFrom',
    right: { kind: 'prepared-param-ref', nullable: true },
  });
  expect(grouped.preGroupState.limit).toBe(7);
  expect(grouped.postGroup).toMatchObject({
    limit: { kind: 'prepared-param-ref' },
    offset: { kind: 'prepared-param-ref' },
  });
  expect(() => grouped.prepared.aggregate((agg) => ({ total: agg.count() }))).not.toThrow();
  expect(() => collection.groupBy('userId').having((h) => h.count().gt(nullable as never))).toThrow(
    expect.objectContaining({ code: 'ORM.FILTER_UNSUPPORTED' }),
  );
});

it('rejects invalid prepared comparands and standalone parameters without broadening HAVING', () => {
  const { collection } = createCollectionFor('Post');
  const grouped = collection.groupBy('userId');
  expect(() => grouped.having((h) => h.count().eq(parameter('pg/text@1', false) as never))).toThrow(
    expect.objectContaining({ code: 'ORM.HAVING_EXPRESSION_UNSUPPORTED' }),
  );
  const arbitrary = {
    returnType: { codecId: 'pg/int8number@1', nullable: false },
    buildAst: () => ColumnRef.of('posts', 'views'),
  };
  expect(() => grouped.having((h) => h.count().eq(arbitrary as never))).toThrow(
    expect.objectContaining({ code: 'ORM.HAVING_EXPRESSION_UNSUPPORTED' }),
  );
  expect(() =>
    grouped
      .having(() => PreparedParamRef.of('value', { codecId: 'pg/int4@1' }))
      .prepared.aggregate((agg) => ({ total: agg.count() })),
  ).toThrow(expect.objectContaining({ code: 'ORM.HAVING_EXPRESSION_UNSUPPORTED' }));
  const configure = vi.fn();
  expect(() => grouped.prepared.aggregate(() => ({}), configure)).toThrow(
    expect.objectContaining({ code: 'ORM.AGGREGATE_SELECTOR_MISSING' }),
  );
  expect(() => grouped.prepared.aggregate(() => ({ invalid: {} as never }), configure)).toThrow(
    expect.objectContaining({ code: 'ORM.AGGREGATE_SELECTOR_INVALID' }),
  );
  expect(configure).not.toHaveBeenCalled();
});
