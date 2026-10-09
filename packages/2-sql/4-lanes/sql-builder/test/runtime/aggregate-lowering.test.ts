/**
 * Descriptor lowering applies only where the aggregate value crosses the
 * driver boundary — the SELECT projection. HAVING and ORDER BY compare the
 * value inside the database, where a rendering like SQLite's
 * `CAST(count(*) AS TEXT)` would change SQL semantics ('10' < '9' as text),
 * so those positions consume the plain aggregate.
 */

import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import {
  AggregateExpr,
  type BinaryExpr,
  CastExpr,
  IdentifierRef,
} from '@internal/sql-relational-core/ast';
import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { ExpressionImpl } from '@internal/sql-relational-core/functions';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { createAggregateFunctions } from '../../src/runtime/functions';
import { sql } from '../../src/runtime/sql';
import type { QueryContext } from '../../src/scope';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

/**
 * A registry in the SQLite shape: count and integer sum resolve to a wide
 * integer codec and carry a lowering that renders the result as text — the
 * form the driver can read past 2^53.
 */
function loweringAggregateRegistry() {
  return buildSqlAggregateDescriptorRegistry(
    [
      {
        operation: 'count',
        input: { kind: 'any' },
        output: { kind: 'codec', codecId: 'lib/int8@1' },
        nullable: false,
        emptyResultJson: '0',
        lower: ({ expr }: { expr?: AggregateExpr['expr'] }) =>
          CastExpr.as(new AggregateExpr('count', expr), 'text'),
      },
      {
        operation: 'sum',
        input: { kind: 'trait', trait: 'numeric' },
        output: { kind: 'codec', codecId: 'lib/int8@1' },
        nullable: true,
        lower: ({ expr }: { expr?: AggregateExpr['expr'] }) =>
          CastExpr.as(new AggregateExpr('sum', expr), 'text'),
      },
    ],
    buildCodecDescriptorRegistry([
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
    ] as never),
  );
}

const sqlContract = validateSqlContractFully<Contract>(contractJson);

const stubInferer = { inferCodec: () => 'pg/text@1' };

function db() {
  return sql({
    context: {
      operations: {},
      codecs: {},
      queryOperations: { entries: () => ({}) },
      aggregateDescriptors: loweringAggregateRegistry(),
      types: {},
      applyMutationDefaults: () => [],
      contract: sqlContract,
    } as unknown as ExecutionContext<typeof sqlContract>,
    rawCodecInferer: stubInferer,
  });
}

/** The static face of {@link loweringAggregateRegistry}: count answers without an input. */
type LoweringQC = Omit<QueryContext, 'aggregateTypes'> & {
  aggregateTypes: {
    count: {
      byCodec: Record<never, never>;
      withoutInput: { output: 'lib/int8@1'; nullable: false };
      anyInput: { output: 'lib/int8@1'; nullable: false };
    };
  };
};

describe('aggregate() with a lowering descriptor', () => {
  it('builds the plain aggregate and carries the lowered form for projection', () => {
    const fns = createAggregateFunctions<LoweringQC>({}, stubInferer, loweringAggregateRegistry());
    const result = fns.count() as ExpressionImpl;

    expect(result.buildAst()).toEqual(AggregateExpr.count());
    expect(result.buildProjectionAst()).toEqual(CastExpr.as(AggregateExpr.count(), 'text'));
    // The resolved output codec stays attached either way — decoding depends on it.
    expect(result.returnType).toEqual({
      codecId: 'lib/int8@1',
      nullable: false,
      codec: { codecId: 'lib/int8@1' },
    });
  });
});

describe('descriptor lowering sites', () => {
  it('renders the lowered form in an aliased select projection and keeps the resolved codec', () => {
    const ast = db()
      .public.users.select('c', (_f, fns) => fns.count())
      .buildAst();

    const item = ast.projection[0]!;
    expect(item.expr).toEqual(CastExpr.as(AggregateExpr.count(), 'text'));
    expect(item.codec).toEqual({ codecId: 'lib/int8@1' });
  });

  it('renders the lowered form in a record select projection', () => {
    const ast = db()
      .public.users.select((f, fns) => ({ total: fns.sum(f.id) }))
      .buildAst();

    const item = ast.projection[0]!;
    expect(item.expr).toEqual(CastExpr.as(AggregateExpr.sum(IdentifierRef.of('id')), 'text'));
    expect(item.codec).toEqual({ codecId: 'lib/int8@1' });
  });

  it('renders the plain aggregate in HAVING', () => {
    const ast = db()
      .public.users.select('id')
      .groupBy('id')
      .having((_f, fns) => fns.gt(fns.count(), 1))
      .buildAst();

    const having = ast.having as BinaryExpr;
    expect(having.left).toEqual(AggregateExpr.count());
  });

  it('renders the plain aggregate in ORDER BY', () => {
    const ast = db()
      .public.users.select('id')
      .groupBy('id')
      .orderBy((_f, fns) => fns.count(), { direction: 'desc' })
      .buildAst();

    const item = ast.orderBy![0]!;
    expect(item.expr).toEqual(AggregateExpr.count());
    expect(item.dir).toBe('desc');
  });
});
