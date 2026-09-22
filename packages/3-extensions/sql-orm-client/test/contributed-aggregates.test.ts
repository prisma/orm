/**
 * The ORM's aggregate surfaces are derived, not spelled out: the callable set
 * comes from the operations the composed registry contributes. A contributed
 * name surfaces on the include reducers and the aggregate builder, an
 * operation the registry does not contribute is no method at all, an
 * operation outside the SQL aggregate alphabet is refused in HAVING, and a
 * name that would shadow a collection builder member is rejected at ORM
 * composition.
 */

import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import {
  AggregateExpr,
  type AnyExpression,
  FunctionCallExpr,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it, vi } from 'vitest';
import { createAggregateBuilder } from '../src/aggregate-builder';
import { Collection, reservedCollectionMemberNames } from '../src/collection';
import { orm } from '../src/orm';
import type { AggregateSelector } from '../src/types';
import { emptyState } from '../src/types';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

const countAny: SqlAggregateDescriptor = {
  operation: 'count',
  input: { kind: 'any' },
  output: { kind: 'codec', codecId: 'pg/int8@1' },
  nullable: false,
  emptyResultJson: '0',
};

/** A tally whose result codec produces a JavaScript number from the digit text `pg/int8` stores. */
const headcountAny: SqlAggregateDescriptor = {
  operation: 'headcount',
  input: { kind: 'any' },
  output: { kind: 'codec', codecId: 'pg/int8number@1' },
  nullable: false,
  emptyResultJson: '0',
  lower: ({ expr }) => new AggregateExpr('count', expr),
};

const medianOverNumeric: SqlAggregateDescriptor = {
  operation: 'median',
  input: { kind: 'trait', trait: 'numeric' },
  output: { kind: 'codec', codecId: 'pg/float8@1' },
  nullable: true,
  lower: ({ expr }) => FunctionCallExpr.of('median', expr === undefined ? [] : [expr]),
};

const tallyWithoutInput: SqlAggregateDescriptor = {
  operation: 'tally',
  input: { kind: 'none' },
  output: { kind: 'codec', codecId: 'pg/int8@1' },
  nullable: false,
  emptyResultJson: '0',
  lower: () => FunctionCallExpr.of('tally', []),
};

function contextWith(descriptors: readonly unknown[]): ExecutionContext<TestContract> {
  const base = getTestContext();
  return {
    ...base,
    aggregateDescriptors: buildSqlAggregateDescriptorRegistry(descriptors, base.codecDescriptors),
  };
}

type DynamicAggregateMethods = Record<
  string,
  ((field?: string) => AggregateSelector<unknown>) | undefined
>;

describe('derived include reducers', () => {
  const context = contextWith([countAny, medianOverNumeric, tallyWithoutInput]);

  function refinementCollection() {
    return new Collection({ runtime: createMockRuntime(), context }, 'Post', {
      namespaceId: 'public',
      includeRefinementMode: true,
    });
  }

  it('surfaces every contributed operation as a reducer', () => {
    const posts = refinementCollection();
    const dynamic = posts as unknown as DynamicAggregateMethods;

    expect(dynamic['median']?.('views')).toEqual({
      kind: 'includeScalar',
      fn: 'median',
      column: 'views',
      state: posts.state,
    });
    expect(dynamic['tally']?.()).toEqual({
      kind: 'includeScalar',
      fn: 'tally',
      state: posts.state,
    });
  });

  it('surfaces no operation the registry does not contribute', () => {
    const dynamic = refinementCollection() as unknown as DynamicAggregateMethods;

    expect(dynamic['sum']).toBeUndefined();
    expect(dynamic['avg']).toBeUndefined();
  });

  it('a reducer outside an include refinement raises ORM.INCLUDE_INVALID', () => {
    const posts = new Collection({ runtime: createMockRuntime(), context }, 'Post', {
      namespaceId: 'public',
    });
    const dynamic = posts as unknown as DynamicAggregateMethods;

    expect(() => dynamic['median']?.('views')).toThrow(
      expect.objectContaining({
        code: 'ORM.INCLUDE_INVALID',
        meta: { action: 'median()' },
      }),
    );
  });
});

describe('derived aggregate builder', () => {
  it('surfaces contributed operations with their call shapes and no others', () => {
    const context = contextWith([countAny, medianOverNumeric, tallyWithoutInput]);
    const builder = createAggregateBuilder(
      context.contract,
      context.aggregateDescriptors,
      'public',
      'Post',
    ) as unknown as DynamicAggregateMethods;

    expect(builder['median']?.('views')).toEqual({
      kind: 'aggregate',
      fn: 'median',
      column: 'views',
    });
    expect(builder['tally']?.()).toEqual({ kind: 'aggregate', fn: 'tally' });
    expect(builder['sum']).toBeUndefined();
  });
});

describe('empty-input answers', () => {
  it('prepared consumers retain metadata but convert contributed empty values separately', async () => {
    const runtime = createMockRuntime();
    const lower = vi.fn(headcountAny.lower!);
    const context = contextWith([{ ...headcountAny, lower }]);
    const resolve = vi.spyOn(context.aggregateDescriptors, 'resolve');
    const original = context.contractCodecs.forCodecRef.bind(context.contractCodecs);
    const decodeJson = vi.fn(() => ({ value: 0 }));
    const codecs = vi.spyOn(context.contractCodecs, 'forCodecRef').mockImplementation((ref) => ({
      ...original(ref),
      decodeJson,
    }));
    const posts = new Collection({ runtime, context }, 'Post', { namespaceId: 'public' });
    const description = posts.prepared.aggregate((agg) => ({
      total: (agg as unknown as DynamicAggregateMethods)['headcount']!(),
    }));
    const resolutions = resolve.mock.calls.length;
    const bindings = codecs.mock.calls.length;
    expect(resolutions).toBeGreaterThan(0);
    expect(bindings).toBeGreaterThan(0);
    expect(lower).toHaveBeenCalledOnce();
    expect(decodeJson).not.toHaveBeenCalled();
    const rows = (values: Record<string, unknown>[]) =>
      new AsyncIterableResult(
        (async function* () {
          yield* values;
        })(),
      );
    const [a, b] = await Promise.all([
      description.consume(rows([])),
      description.consume(rows([{ total: null }])),
    ]);
    expect(a).toEqual({ total: { value: 0 } });
    expect(b).toEqual(a);
    expect(a.total).not.toBe(b.total);
    expect(decodeJson).toHaveBeenCalledTimes(2);
    const decoded = { value: 7 };
    expect(await description.consume(rows([{ total: decoded }]))).toEqual({ total: decoded });
    expect(decodeJson).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(resolutions);
    expect(codecs).toHaveBeenCalledTimes(bindings);
    expect(lower).toHaveBeenCalledOnce();
    expect(runtime.executions).toEqual([]);
    codecs.mockRestore();
    resolve.mockRestore();
  });

  // Each non-nullable row declares its empty answer in its own result codec's
  // canonical JSON, so the two rows below answer in different forms from the
  // same zero: decimal text reads back as a `bigint`, a JSON number as a
  // `number`. Reading either through the other's form is what the declaration
  // exists to prevent.
  it('derive from the declared row: its own zero for a non-nullable result, null for a nullable one', async () => {
    const runtime = createMockRuntime();
    const context = contextWith([countAny, headcountAny, medianOverNumeric]);
    const posts = new Collection({ runtime, context }, 'Post', { namespaceId: 'public' });
    runtime.setNextResults([[]]);

    await expect(
      posts.aggregate((agg) => {
        const dynamic = agg as unknown as DynamicAggregateMethods;
        return {
          total: dynamic['count']?.() as AggregateSelector<unknown>,
          headcount: dynamic['headcount']?.() as AggregateSelector<unknown>,
          mid: dynamic['median']?.('views') as AggregateSelector<unknown>,
        };
      }),
    ).resolves.toEqual({ total: 0n, headcount: 0, mid: null });
  });
});

describe('projection-only operations in HAVING', () => {
  it('refuses a contributed operation outside the SQL aggregate alphabet', () => {
    const context = contextWith([countAny, medianOverNumeric]);
    const posts = new Collection({ runtime: createMockRuntime(), context }, 'Post', {
      namespaceId: 'public',
    });
    const grouped = posts.groupBy('views');

    expect(() =>
      grouped.having((having) => {
        const dynamic = having as unknown as Record<
          string,
          (field?: string) => { gt(value: number): AnyExpression }
        >;
        return dynamic['median']!('views').gt(1);
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.AGGREGATE_PROJECTION_ONLY',
        meta: { operation: 'median' },
      }),
    );
  });
});

describe('reserved operation names', () => {
  const shadowingBuilderMethod: SqlAggregateDescriptor = {
    operation: 'where',
    input: { kind: 'any' },
    output: { kind: 'codec', codecId: 'pg/int8@1' },
    nullable: false,
    emptyResultJson: '0',
    lower: ({ expr }) => FunctionCallExpr.of('shadow', expr === undefined ? [] : [expr]),
  };
  const shadowingInstanceMember: SqlAggregateDescriptor = {
    ...shadowingBuilderMethod,
    operation: 'state',
  };

  it('a contributed operation shadowing a builder method is rejected at composition', () => {
    const context = contextWith([shadowingBuilderMethod]);

    expect(() => orm({ runtime: createMockRuntime(), context })).toThrow(
      expect.objectContaining({
        code: 'ORM.AGGREGATE_OPERATION_RESERVED',
        meta: { operation: 'where' },
      }),
    );
  });

  it('a contributed operation shadowing an instance member is rejected at composition', () => {
    const context = contextWith([shadowingInstanceMember]);

    expect(() => orm({ runtime: createMockRuntime(), context })).toThrow(
      expect.objectContaining({
        code: 'ORM.AGGREGATE_OPERATION_RESERVED',
        meta: { operation: 'state' },
      }),
    );
  });

  it('the reserved set covers every member a live collection carries', () => {
    const context = contextWith([]);
    const posts = new Collection({ runtime: createMockRuntime(), context }, 'Post', {
      namespaceId: 'public',
      state: emptyState(),
    });
    const reserved = reservedCollectionMemberNames();

    for (const name of Object.getOwnPropertyNames(posts)) {
      expect(reserved).toContain(name);
    }
  });
});
