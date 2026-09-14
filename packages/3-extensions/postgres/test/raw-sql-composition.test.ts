import { postgresRawCodecInferer } from '@internal/adapter-postgres/adapter';
import { createAggregateFunctions, sql } from '@internal/sql-builder/runtime';
import type { AnyExpression } from '@internal/sql-relational-core/ast';
import {
  AggregateExpr,
  BinaryExpr,
  IdentifierRef,
  RawExpr,
} from '@internal/sql-relational-core/ast';
import { createRawSql } from '@internal/sql-relational-core/expression';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/namespaced-contract';

// These cases exercise the raw-SQL tag, not aggregate resolution, so the stub
// contributes only what the one count() call among them needs.
const countOnlyAggregates = {
  resolve: (operation: string) =>
    operation === 'count'
      ? {
          operation,
          output: { codecId: 'pg/int8@1' },
          nullable: false as const,
          emptyResultJson: '0',
          lower: undefined,
        }
      : undefined,
  values: function* () {
    yield {
      operation: 'count',
      input: { kind: 'any' as const },
      output: { kind: 'codec' as const, codecId: 'pg/int8@1' },
      nullable: false as const,
      emptyResultJson: '0',
    };
  },
};

// Stub ExecutionContext used across all composition tests. The concrete fixture
// contract gives `sql()` a typed `public` namespace, so the builder surface
// (`db.public.users`) typechecks directly. The wrapper cast stands in for the
// fields the builder never reads at runtime (codecs, operations, types).
function makeStubContext(): ExecutionContext<Contract> {
  return {
    contract: {
      capabilities: {},
      target: 'postgres',
      storage: {
        storageHash: 'raw-sql-composition-core',
        namespaces: {
          public: {
            id: 'public',
            entries: {
              table: {
                users: {
                  columns: {
                    id: { codecId: 'pg/int4@1', nullable: false },
                    name: { codecId: 'pg/text@1', nullable: false },
                    score: { codecId: 'pg/int4@1', nullable: true },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    },
    queryOperations: { entries: () => ({}) },
    aggregateDescriptors: countOnlyAggregates,
    applyMutationDefaults: () => [],
  } as unknown as ExecutionContext<Contract>;
}

// `createAggregateFunctions` returns a generic `Functions<QC>` whose `rawSql` field
// may be `RawSqlTag | undefined` depending on the QC type parameter. In these tests
// we always construct the fns with a concrete tag, so the field is always present;
// casting via `as unknown as { rawSql: RawSqlTag }` is safe here and avoids
// propagating the generic QC type into test scaffolding.
function rawSqlOf(fns: unknown, tag: ReturnType<typeof createRawSql>): typeof tag {
  return (fns as unknown as { raw: typeof tag }).raw;
}

describe('rawSql composition with the typed builder', () => {
  it('aliased single-column select emits a RawExpr in the projection list', () => {
    const adapter = postgresRawCodecInferer;
    const ctx = makeStubContext();
    const db = sql({ context: ctx, rawCodecInferer: adapter });

    let capturedAst: AnyExpression | undefined;
    db.public.users
      .select('greeting', (_f, fns) => {
        const expr = fns.raw`'hello'`.returns('pg/text@1');
        capturedAst = expr.buildAst();
        return expr;
      })
      .buildAst();

    expect(capturedAst).toBeInstanceOf(RawExpr);
    const raw = capturedAst as RawExpr;
    expect(raw.returns.codecId).toBe('pg/text@1');
  });

  it('aliased single-column select with field interpolation produces the correct RawExpr parts', () => {
    const adapter = postgresRawCodecInferer;
    const tag = createRawSql(adapter);

    // Use createAggregateFunctions directly — same dispatch path as the aliased-select branch.
    const fns = createAggregateFunctions({}, adapter, countOnlyAggregates);
    const rawSql = rawSqlOf(fns, tag);

    // Field proxy top-level access produces IdentifierRef (not ColumnRef); simulate that here.
    const nameExpr = {
      buildAst: () => IdentifierRef.of('name'),
      returnType: { codecId: 'pg/text@1', nullable: false },
    };
    const expr = rawSql`'hello ' || ${nameExpr}`.returns('pg/text@1');
    const ast = expr.buildAst();

    expect(ast).toBeInstanceOf(RawExpr);
    const raw = ast as RawExpr;
    // Template literal `'hello ' || ${nameExpr}` produces three parts:
    // [ "'hello ' || ", IdentifierRef("name"), "" ]
    expect(raw.parts).toHaveLength(3);
    expect(raw.parts[0]).toBe("'hello ' || ");
    expect(raw.parts[1]).toBeInstanceOf(IdentifierRef);
    expect((raw.parts[1] as IdentifierRef).name).toBe('name');
    expect(raw.parts[2]).toBe('');
  });

  it('bulk-object select AST contains a ColumnRef entry and a RawExpr entry', () => {
    const adapter = postgresRawCodecInferer;
    const tag = createRawSql(adapter);

    // Use createAggregateFunctions directly — same dispatch path as the bulk-object-select branch.
    const fns = createAggregateFunctions({}, adapter, countOnlyAggregates);
    const rawSql = rawSqlOf(fns, tag);

    const idExpr = {
      buildAst: () => IdentifierRef.of('id'),
      returnType: { codecId: 'pg/int4@1', nullable: false },
    };
    const rawExpr = rawSql`coalesce(score, 0)`.returns('pg/int4@1');

    const asts = [idExpr.buildAst(), rawExpr.buildAst()];
    expect(asts[0]).toBeInstanceOf(IdentifierRef);
    expect(asts[1]).toBeInstanceOf(RawExpr);
  });

  it('bulk-object select via the typed builder wires the RawExpr through the AST', () => {
    const adapter = postgresRawCodecInferer;
    const tag = createRawSql(adapter);
    const ctx = makeStubContext();
    const db = sql({ context: ctx, rawCodecInferer: adapter });

    const capturedAsts: AnyExpression[] = [];
    db.public.users
      .select((_f, fns) => {
        const rawSql = rawSqlOf(fns, tag);
        const rawExpr = rawSql`coalesce(score, 0)`.returns('pg/int4@1');
        capturedAsts.push(rawExpr.buildAst());
        return { b: rawExpr };
      })
      .buildAst();

    expect(capturedAsts[0]).toBeInstanceOf(RawExpr);
  });

  it('where with fns.gt(rawSql, literal) produces a BinaryExpr whose left operand is a RawExpr', () => {
    const adapter = postgresRawCodecInferer;
    const tag = createRawSql(adapter);

    // Use createAggregateFunctions directly — same dispatch path as the .where branch.
    const fns = createAggregateFunctions({}, adapter, countOnlyAggregates);
    const rawSql = rawSqlOf(fns, tag);

    // Top-level field proxy produces IdentifierRef for createdAt.
    const createdAtExpr = {
      buildAst: () => IdentifierRef.of('createdAt'),
      returnType: { codecId: 'pg/timestamptz-temporal@1', nullable: false },
    };

    const epochExpr = rawSql`extract(epoch from ${createdAtExpr})`.returns('pg/int4@1');

    // Functions<QC>.gt is typed via the generic QC; casting to a narrow concrete shape avoids
    // threading the full QC type parameter through test scaffolding.
    const gtResult = (
      fns as unknown as { gt: (a: unknown, b: unknown) => { buildAst(): AnyExpression } }
    ).gt(epochExpr, 1_700_000_000);
    const whereAst = gtResult.buildAst();

    expect(whereAst).toBeInstanceOf(BinaryExpr);
    const binary = whereAst as BinaryExpr;
    expect(binary.op).toBe('gt');
    // The left operand must be the RawExpr produced by fns.raw`extract(...)`.
    expect(binary.left).toBeInstanceOf(RawExpr);
    const leftRaw = binary.left as RawExpr;
    expect(leftRaw.parts[0]).toBe('extract(epoch from ');
    expect(leftRaw.parts[1]).toBeInstanceOf(IdentifierRef);
    expect(leftRaw.parts[2]).toBe(')');
  });

  it('fns.count(rawSql) produces an AggregateExpr whose argument is a RawExpr', () => {
    const adapter = postgresRawCodecInferer;
    const tag = createRawSql(adapter);

    const fns = createAggregateFunctions({}, adapter, countOnlyAggregates);
    const rawSql = rawSqlOf(fns, tag);

    // Top-level field proxy produces IdentifierRef for score.
    const scoreExpr = {
      buildAst: () => IdentifierRef.of('score'),
      returnType: { codecId: 'pg/int4@1', nullable: true },
    };

    const coalesced = rawSql`coalesce(${scoreExpr}, 0)`.returns('pg/int4@1');
    // Functions<QC>.count is typed via the generic QC; casting to a narrow concrete shape avoids
    // threading the full QC type parameter through test scaffolding.
    const countResult = (
      fns as unknown as { count: (expr: unknown) => { buildAst(): AnyExpression } }
    ).count(coalesced);
    const countAst = countResult.buildAst();

    expect(countAst).toBeInstanceOf(AggregateExpr);
    const agg = countAst as AggregateExpr;
    expect(agg.fn).toBe('count');
    // The argument passed to COUNT must be the RawExpr produced by fns.raw`coalesce(...)`.
    expect(agg.expr).toBeInstanceOf(RawExpr);
    const argRaw = agg.expr as RawExpr;
    expect(argRaw.parts[0]).toBe('coalesce(');
    expect(argRaw.parts[1]).toBeInstanceOf(IdentifierRef);
    expect(argRaw.parts[2]).toBe(', 0)');
  });

  it('nested rawSql: outer parts array contains inner RawExpr as an expression element', () => {
    const adapter = postgresRawCodecInferer;
    const tag = createRawSql(adapter);

    const fns = createAggregateFunctions({}, adapter, countOnlyAggregates);
    const rawSql = rawSqlOf(fns, tag);

    const scoreExpr = {
      buildAst: () => IdentifierRef.of('score'),
      returnType: { codecId: 'pg/int4@1', nullable: true },
    };

    const inner = rawSql`coalesce(${scoreExpr}, 0)`.returns('pg/int4@1');
    const outer = rawSql`json_build_object('val', ${inner})`.returns('pg/text@1');

    const outerAst = outer.buildAst();
    expect(outerAst).toBeInstanceOf(RawExpr);

    const outerRaw = outerAst as RawExpr;
    // Template literal `json_build_object('val', ${inner})` produces:
    // [ "json_build_object('val', ", innerRawExpr, ")" ]
    expect(outerRaw.parts).toHaveLength(3);
    expect(outerRaw.parts[0]).toBe("json_build_object('val', ");
    expect(outerRaw.parts[1]).toBeInstanceOf(RawExpr);
    expect(outerRaw.parts[2]).toBe(')');

    // The inner RawExpr retains its own parts structure.
    const innerRaw = outerRaw.parts[1] as RawExpr;
    expect(innerRaw.parts).toHaveLength(3);
    expect(innerRaw.parts[0]).toBe('coalesce(');
    expect(innerRaw.parts[1]).toBeInstanceOf(IdentifierRef);
    expect(innerRaw.parts[2]).toBe(', 0)');
  });

  it('nested rawSql: inner IdentifierRef descends correctly through the outer RawExpr fold', () => {
    const adapter = postgresRawCodecInferer;
    const tag = createRawSql(adapter);

    const fns = createAggregateFunctions({}, adapter, countOnlyAggregates);
    const rawSql = rawSqlOf(fns, tag);

    const scoreExpr = {
      buildAst: () => IdentifierRef.of('score'),
      returnType: { codecId: 'pg/int4@1', nullable: true },
    };

    const inner = rawSql`coalesce(${scoreExpr}, 0)`.returns('pg/int4@1');
    const outer = rawSql`json_build_object('val', ${inner})`.returns('pg/text@1');

    const outerAst = outer.buildAst() as RawExpr;
    const innerAst = outerAst.parts[1] as RawExpr;
    const identRef = innerAst.parts[1] as IdentifierRef;

    // The IdentifierRef at depth 2 carries the correct column name.
    expect(identRef).toBeInstanceOf(IdentifierRef);
    expect(identRef.name).toBe('score');
  });
});
