import type { Contract as FrameworkContract } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { type SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { defineContract } from '@internal/sql-contract-ts/contract-builder';
import { type ParamRef, RawQueryAst } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../../1-core/contract/test/test-support';
import type { BuilderContext } from '../../src/runtime/builder-base';
import { createRawLane } from '../../src/runtime/raw-lane';
import { sql } from '../../src/runtime/sql';
import { TableProxyImpl } from '../../src/runtime/table-proxy-impl';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

const sqlContract = validateSqlContractFully<Contract>(contractJson);

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  aggregateDescriptors: { resolve: () => undefined, values: function* () {} },
  types: {},
  applyMutationDefaults: () => [],
};

function rawLane() {
  return createRawLane({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
    rawCodecInferer: { inferCodec: () => 'pg/int4@1' },
  });
}

function db() {
  return sql({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
    rawCodecInferer: { inferCodec: () => 'pg/int4@1' },
  });
}

describe('contract-bound raw statements', () => {
  it('reads a column reference off the table proxy', () => {
    expect(db().public.users.columns.id).toEqual({ codecId: 'pg/int4@1', nullable: false });
    expect(db().public.users.columns.invited_by_id).toEqual({
      codecId: 'pg/int4@1',
      nullable: true,
    });
  });

  it('exposes no reference for a column the table does not declare', () => {
    expect(db().public.users.columns['nonexistent' as 'id']).toBeUndefined();
  });

  // Reads as the surface is meant to be used: one template, one row spec
  // mixing contract columns with a computed column, one terminator.
  it('builds a plan whose row spec resolves both entry forms', () => {
    const d = rawLane();
    const users = db().public.users;

    const plan = d.sql`
      SELECT u.id, u.email, count(p.id) AS post_count
      FROM users u JOIN posts p ON p.user_id = u.id
      WHERE u.invited_by_id = ${1}
      GROUP BY u.id, u.email
    `
      .returnsRow({
        id: users.columns.id,
        email: users.columns.email,
        post_count: 'pg/int8@1',
      })
      .build();

    expect(plan.ast).toBeInstanceOf(RawQueryAst);
    expect((plan.ast as RawQueryAst).result).toEqual({
      kind: 'rows',
      columns: {
        id: { codecId: 'pg/int4@1', nullable: false },
        email: { codecId: 'pg/text@1', nullable: false },
        post_count: { codecId: 'pg/int8@1', nullable: false },
      },
    });
    expect(plan.meta).toMatchObject({
      target: sqlContract.target,
      targetFamily: sqlContract.targetFamily,
      lane: 'raw',
    });
  });

  it('binds interpolated values through the adapter inferer', () => {
    const plan = rawLane().sql`SELECT id FROM users WHERE id = ${7}`
      .returnsRow({ id: 'pg/int4@1' })
      .build();

    const params = (plan.ast as RawQueryAst).collectParamRefs();
    expect(params).toHaveLength(1);
    expect((params[0] as ParamRef).value).toBe(7);
    expect((params[0] as ParamRef).codec?.codecId).toBe('pg/int4@1');
  });

  it('builds an affected-count plan from a mutation template', () => {
    const plan = rawLane().sql`UPDATE users SET name = ${'Ada'} WHERE id = ${1}`
      .affectedCount()
      .build();

    expect((plan.ast as RawQueryAst).result).toEqual({ kind: 'affected-count' });
  });

  it('splices a row-returning statement into another template', () => {
    const d = rawLane();
    const invited = d.sql`SELECT id FROM users WHERE invited_by_id = ${1}`.returnsRow({
      id: db().public.users.columns.id,
    });

    const plan = d.sql`WITH invited AS (${invited}) SELECT count(*) AS n FROM invited`
      .returnsRow({ n: 'pg/int8@1' })
      .build();

    const ast = plan.ast as RawQueryAst;
    expect(ast.parts.some((part) => part instanceof RawQueryAst)).toBe(false);
    expect(ast.collectParamRefs()).toHaveLength(1);
  });
});

describe('a storage namespace named raw', () => {
  // Authored through the contract builder so the namespace is one the emitter
  // could really produce: the target pack's default namespace names it.
  const rawNamespaceContract = defineContract(
    {
      family: {
        kind: 'family',
        id: 'sql',
        familyId: 'sql',
        version: '0.0.1',
        authoring: {
          field: {
            text: { kind: 'fieldPreset', output: { codecId: 'pg/text@1', nativeType: 'text' } },
          },
        },
      } as const satisfies FamilyPackRef<'sql'>,
      target: {
        kind: 'target',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        defaultNamespaceId: 'raw',
      } as const satisfies TargetPackRef<'sql', 'postgres'>,
      createNamespace: createTestSqlNamespace,
    },
    ({ field: f, model: m }) =>
      ({
        models: {
          Note: m('Note', { fields: { id: f.text().id() } }),
        },
      }) as const,
  ) as FrameworkContract<SqlStorage>;

  it('is reachable like any other namespace', () => {
    const db = sql({
      context: { ...stubBase, contract: rawNamespaceContract } as unknown as ExecutionContext<
        typeof rawNamespaceContract
      >,
      rawCodecInferer: { inferCodec: () => 'pg/text@1' },
    });

    expect(db['raw']?.['Note']?.columns['id']).toEqual({ codecId: 'pg/text@1', nullable: false });
  });

  it('builds a query against its tables', () => {
    const db = sql({
      context: { ...stubBase, contract: rawNamespaceContract } as unknown as ExecutionContext<
        typeof rawNamespaceContract
      >,
      rawCodecInferer: { inferCodec: () => 'pg/text@1' },
    });
    const plan = db['raw']?.['Note']?.select('id').build();

    expect(plan?.ast.kind).toBe('select');
  });
});

describe('storage column names that collide with object machinery', () => {
  // A quoted SQL identifier may be anything, so storage can carry a column
  // named `__proto__` — StorageTable keeps it as an own property, and the
  // proxy has to report what storage states. The contract-builder DSL cannot
  // express the name, so the getter is exercised against its own typed input.
  const table = new StorageTable({
    columns: Object.fromEntries([
      ['id', { many: false, codecId: 'pg/text@1', nullable: false, nativeType: 'text' }],
      ['__proto__', { many: false, codecId: 'pg/text@1', nullable: true, nativeType: 'text' }],
    ]),
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });

  const proxy = () =>
    new TableProxyImpl(
      'Note',
      table,
      'Note',
      { ...stubBase, storage: undefined } as unknown as BuilderContext,
      'public',
    );

  it('reports a __proto__ column as an own property of the refs record', () => {
    const columns = proxy().columns;
    const byName = new Map(Object.entries(columns));

    expect(Object.keys(columns)).toEqual(['id', '__proto__']);
    expect(Object.hasOwn(columns, '__proto__')).toBe(true);
    expect(byName.get('__proto__')).toEqual({ codecId: 'pg/text@1', nullable: true });
  });

  it('leaves the refs record frozen on the ordinary object prototype', () => {
    const columns = proxy().columns;

    expect(Object.getPrototypeOf(columns)).toBe(Object.prototype);
    expect(Object.isFrozen(columns)).toBe(true);
  });
});

describe("the refs a row-spec'd statement publishes", () => {
  it('names each declared column with its codec and nullability', () => {
    const inner = rawLane().sql`SELECT id, email FROM users`.returnsRow({
      id: db().public.users.columns.id,
      email: { codecId: 'pg/text@1', nullable: true },
    });

    expect(inner.returns).toEqual({
      id: { codecId: 'pg/int4@1', nullable: false },
      email: { codecId: 'pg/text@1', nullable: true },
    });
  });

  it('is frozen, on the ordinary object prototype, and reusable as a spec entry', () => {
    const inner = rawLane().sql`SELECT id FROM users`.returnsRow({
      id: db().public.users.columns.id,
    });

    expect(Object.isFrozen(inner.returns)).toBe(true);
    expect(Object.getPrototypeOf(inner.returns)).toBe(Object.prototype);

    const outer = rawLane().sql`WITH i AS (${inner}) SELECT id FROM i`
      .returnsRow({ id: inner.returns.id })
      .build();

    expect((outer.ast as RawQueryAst).result).toEqual({
      kind: 'rows',
      columns: { id: { codecId: 'pg/int4@1', nullable: false } },
    });
  });

  it('is absent from an affected-count query', () => {
    const bump = rawLane().sql`UPDATE users SET name = ${'Ada'}`.affectedCount();

    expect(Object.hasOwn(bump, 'returns')).toBe(false);
  });
});
