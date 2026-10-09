/**
 * The lane's aggregate surface is derived, not spelled out: the callable set
 * comes from the operations the composed registry contributes, and an
 * operation outside the SQL aggregate alphabet exists only in its
 * descriptor-lowered form — the projection consumes it, while HAVING and
 * ORDER BY refuse it at authoring time.
 */

import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import {
  type AnyExpression,
  FunctionCallExpr,
  IdentifierRef,
} from '@internal/sql-relational-core/ast';
import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { ExpressionImpl } from '@internal/sql-relational-core/functions';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import type { Expression } from '../../src/expression';
import { createFieldProxy } from '../../src/runtime/field-proxy';
import { createAggregateFunctions } from '../../src/runtime/functions';
import { sql } from '../../src/runtime/sql';
import type { QueryContext, ScopeField } from '../../src/scope';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';
import { usersScope } from './test-helpers';

const stubInferer = { inferCodec: () => 'pg/text@1' };

const codecs = buildCodecDescriptorRegistry([
  {
    codecId: 'pg/int4@1',
    traits: ['numeric', 'order', 'equality'],
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => () => ({ id: 'pg/int4@1' }),
  },
  {
    codecId: 'lib/int8@1',
    traits: ['numeric', 'order', 'equality'],
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => () => ({ id: 'lib/int8@1' }),
  },
  {
    codecId: 'lib/float8@1',
    traits: ['numeric', 'order', 'equality'],
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => () => ({ id: 'lib/float8@1' }),
  },
] as never);

/**
 * A registry whose operation set goes beyond the SQL aggregate alphabet:
 * `median` and `tally` reach SQL only through their lowering hooks, built
 * from existing function-call nodes.
 */
function contributedRegistry() {
  return buildSqlAggregateDescriptorRegistry(
    [
      {
        operation: 'count',
        input: { kind: 'any' },
        output: { kind: 'codec', codecId: 'lib/int8@1' },
        nullable: false,
        emptyResultJson: '0',
      },
      {
        operation: 'median',
        input: { kind: 'trait', trait: 'numeric' },
        output: { kind: 'codec', codecId: 'lib/float8@1' },
        nullable: true,
        lower: ({ expr }: { expr?: AnyExpression }) =>
          FunctionCallExpr.of('median', expr === undefined ? [] : [expr]),
      },
      {
        operation: 'tally',
        input: { kind: 'none' },
        output: { kind: 'codec', codecId: 'lib/int8@1' },
        nullable: false,
        emptyResultJson: '0',
        lower: () => FunctionCallExpr.of('tally', []),
      },
    ],
    codecs,
  );
}

/** The static face of {@link contributedRegistry}. */
type ContributedQC = Omit<QueryContext, 'aggregateTypes'> & {
  aggregateTypes: {
    count: {
      byCodec: Record<never, never>;
      withoutInput: { output: 'lib/int8@1'; nullable: false };
      anyInput: { output: 'lib/int8@1'; nullable: false };
    };
    median: {
      byCodec: Record<never, never>;
      anyInput: { output: 'lib/float8@1'; nullable: true };
    };
    tally: {
      byCodec: Record<never, never>;
      withoutInput: { output: 'lib/int8@1'; nullable: false };
    };
  };
};

const f = () => createFieldProxy(usersScope);

function fns() {
  return createAggregateFunctions<ContributedQC>({}, stubInferer, contributedRegistry());
}

const sqlContract = validateSqlContractFully<Contract>(contractJson);

function db() {
  return sql({
    context: {
      operations: {},
      codecs: {},
      queryOperations: { entries: () => ({}) },
      aggregateDescriptors: contributedRegistry(),
      types: {},
      applyMutationDefaults: () => [],
      contract: sqlContract,
    } as unknown as ExecutionContext<typeof sqlContract>,
    rawCodecInferer: stubInferer,
  });
}

/** The fixture contract types only its own operations; contributed-name calls dispatch dynamically. */
type DynamicAggregates = Record<string, (expr?: Expression<ScopeField>) => Expression<ScopeField>>;

describe('derived aggregate surface', () => {
  it('surfaces every contributed operation as a callable', () => {
    const derived = fns();

    expect(typeof derived.count).toBe('function');
    expect(typeof derived.median).toBe('function');
    expect(typeof derived.tally).toBe('function');
  });

  it('surfaces no operation the registry does not contribute', () => {
    const derived = fns() as unknown as Record<string, unknown>;

    expect(derived['sum']).toBeUndefined();
    expect(derived['avg']).toBeUndefined();
  });

  it('median(expr) carries the lowered form for projection and the declared result codec', () => {
    const result = fns().median(f().id) as ExpressionImpl;

    expect(result.buildProjectionAst()).toEqual(
      FunctionCallExpr.of('median', [IdentifierRef.of('id')]),
    );
    expect(result.returnType).toEqual({
      codecId: 'lib/float8@1',
      nullable: true,
      codec: { codecId: 'lib/float8@1' },
    });
  });

  it('tally() answers the call without an input through the lowered form', () => {
    const result = fns().tally() as ExpressionImpl;

    expect(result.buildProjectionAst()).toEqual(FunctionCallExpr.of('tally', []));
    expect(result.returnType).toEqual({
      codecId: 'lib/int8@1',
      nullable: false,
      codec: { codecId: 'lib/int8@1' },
    });
  });
});

describe('projection-only operations', () => {
  it('building the plain form of an operation outside the alphabet raises ORM.AGGREGATE_PROJECTION_ONLY', () => {
    const result = fns().median(f().id);

    expect(() => result.buildAst()).toThrow(
      expect.objectContaining({
        code: 'ORM.AGGREGATE_PROJECTION_ONLY',
        meta: { operation: 'median' },
      }),
    );
  });

  it('renders the lowered form of a contributed operation in a select projection', () => {
    const ast = db()
      .public.users.select('m', (fields, aggregates) =>
        (aggregates as unknown as DynamicAggregates)['median']!(fields.id),
      )
      .buildAst();

    const item = ast.projection[0]!;
    expect(item.expr).toEqual(FunctionCallExpr.of('median', [IdentifierRef.of('id')]));
    expect(item.codec).toEqual({ codecId: 'lib/float8@1' });
  });

  it('refuses a contributed operation in HAVING at authoring time', () => {
    const grouped = db().public.users.select('id').groupBy('id');

    expect(() =>
      grouped.having((fields, aggregates) =>
        aggregates.gt(
          (aggregates as unknown as DynamicAggregates)['median']!(fields.id) as never,
          1 as never,
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.AGGREGATE_PROJECTION_ONLY',
        meta: { operation: 'median' },
      }),
    );
  });

  it('refuses a contributed operation in ORDER BY at authoring time', () => {
    const grouped = db().public.users.select('id').groupBy('id');

    expect(() =>
      grouped.orderBy(
        (fields, aggregates) =>
          (aggregates as unknown as DynamicAggregates)['median']!(fields.id) as never,
        { direction: 'desc' },
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.AGGREGATE_PROJECTION_ONLY',
        meta: { operation: 'median' },
      }),
    );
  });
});
