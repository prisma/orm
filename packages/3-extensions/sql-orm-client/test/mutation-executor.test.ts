import { textColumn } from '@internal/adapter-postgres/column-types';
import { SqlQueryError, UNIQUE_VIOLATION_SQLSTATE } from '@internal/sql-errors';
import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import {
  assertJunctionParentMetadataLength,
  assertJunctionTargetMetadataLength,
  buildRowIdentityFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
  type JunctionRelationDefinition,
} from '../src/mutation-executor';
import { defineContract, field, model } from './contract-builder';
import type { MockRuntime } from './helpers';
import {
  buildCompositeForeignKeyContract,
  buildCustomPrimaryKeyContract,
  buildExecutionDefaultJunctionContract,
  buildManyToManyContract,
  buildManyToManyContractWithTargetRelation,
  buildTestContextFromContract,
  createMockRuntime,
  getTestContext,
  getTestContract,
  withPatchedDomainModels,
} from './helpers';

function withTransaction(runtime: MockRuntime) {
  const commit = vi.fn(async () => undefined);
  const rollback = vi.fn(async () => undefined);
  const transaction = {
    query: runtime.query.bind(runtime),
    execute: runtime.execute.bind(runtime),
    commit,
    rollback,
  };

  const runtimeWithTransaction = Object.assign(runtime, {
    async transaction() {
      return transaction;
    },
  });

  return {
    runtime: runtimeWithTransaction,
    commit,
    rollback,
  };
}

function withConnection(runtime: MockRuntime, onRelease: () => void) {
  return Object.assign(runtime, {
    async connection() {
      return {
        query: runtime.query.bind(runtime),
        execute: runtime.execute.bind(runtime),
        async release() {
          onRelease();
        },
      };
    },
  });
}

const postIdFilter: AnyExpression = BinaryExpr.eq(ColumnRef.of('posts', 'id'), LiteralExpr.of(1));

const userIdFilter: AnyExpression = BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1));

describe('mutation-executor', () => {
  it('hasNestedMutationCallbacks() detects callbacks only on relation fields', () => {
    const contract = getTestContract();

    expect(
      hasNestedMutationCallbacks(contract, 'public', 'User', {
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 1 }),
      }),
    ).toBe(true);

    expect(
      hasNestedMutationCallbacks(contract, 'public', 'User', {
        posts: { kind: 'connect', criteria: [{ id: 1 }] },
      }),
    ).toBe(false);

    expect(
      hasNestedMutationCallbacks(contract, 'public', 'User', {
        name: () => ({ kind: 'connect' }),
      }),
    ).toBe(false);
  });

  it('hasNestedMutationCallbacks() tolerates malformed relation metadata and unknown models', () => {
    const contract = getTestContract();
    const malformed = withPatchedDomainModels(contract, (models) => {
      const user = models['User'] as {
        relations: Record<string, unknown>;
      };
      return {
        ...models,
        User: {
          ...user,
          relations: {
            ...user.relations,
            notObject: 1,
            missingTo: {
              cardinality: '1:N',
              on: {
                parentCols: ['id'],
                childCols: ['user_id'],
              },
            },
            badCols: {
              to: { model: 'Post', namespace: '__unbound__' },
              cardinality: '1:N',
              on: {
                parentCols: 'id',
                childCols: ['user_id'],
              },
            },
            posts: {
              to: { model: 'Post', namespace: '__unbound__' },
              cardinality: 'INVALID',
              on: {
                localFields: ['id'],
                targetFields: ['userId'],
              },
            },
          },
        },
      };
    });

    expect(
      hasNestedMutationCallbacks(malformed, 'public', 'User', {
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 1 }),
      }),
    ).toBe(true);

    expect(
      hasNestedMutationCallbacks(contract, 'public', 'UnknownModel', {
        anything: () => ({ kind: 'connect' }),
      }),
    ).toBe(false);
  });

  it('buildRowIdentityFilterFromRow() resolves mapped keys and throws when missing', () => {
    const contract = getTestContract();

    expect(buildRowIdentityFilterFromRow(contract, 'public', 'User', { id: 7 })).toEqual({ id: 7 });

    expect(() => buildRowIdentityFilterFromRow(contract, 'public', 'User', {})).toThrow(
      /Missing identity field "id"/,
    );
  });

  it('buildRowIdentityFilterFromRow() resolves custom primary key columns', () => {
    const withCustomPk = buildCustomPrimaryKeyContract();

    expect(buildRowIdentityFilterFromRow(withCustomPk, 'public', 'User', { pk_id: 99 })).toEqual({
      pk_id: 99,
    });
  });

  it('buildRowIdentityFilterFromRow() uses every column of a composite primary key', () => {
    const contract = buildCompositeForeignKeyContract();

    expect(
      buildRowIdentityFilterFromRow(contract, 'public', 'Customer', {
        tenantId: 1,
        id: 2,
        name: 'Grace',
      }),
    ).toEqual({ tenantId: 1, id: 2 });
  });

  it('buildRowIdentityFilterFromRow() throws ORM.ROW_IDENTITY_MISSING for a table without a key', () => {
    const contract = defineContract({
      models: { Log: model('Log', { fields: { message: field.column(textColumn) } }) },
    });

    expect(() =>
      buildRowIdentityFilterFromRow(contract, 'public', 'Log', { message: 'hello' }),
    ).toThrow(expect.objectContaining({ code: 'ORM.ROW_IDENTITY_MISSING' }));
  });

  it('executeNestedCreateMutation() commits transactions on success', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    const transactional = withTransaction(runtime);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime: transactional.runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@example.com' } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(transactional.commit).toHaveBeenCalledTimes(1);
    expect(transactional.rollback).not.toHaveBeenCalled();
  });

  it('executeNestedCreateMutation() supports transaction scopes without commit/rollback hooks', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const runtimeWithBareTransaction = Object.assign(runtime, {
      async transaction() {
        return {
          query: runtime.query.bind(runtime),
          execute: runtime.execute.bind(runtime),
        };
      },
    });

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime: runtimeWithBareTransaction,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@example.com' } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('executeNestedCreateMutation() rolls back transactions on failures', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);
    const transactional = withTransaction(runtime);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime: transactional.runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: { id: 1, name: 'Alice', email: 'alice@example.com' } as never,
      }),
    ).rejects.toThrow(/did not return a row/);

    expect(transactional.commit).not.toHaveBeenCalled();
    expect(transactional.rollback).toHaveBeenCalledTimes(1);
  });

  it('executeNestedCreateMutation() releases scoped connections when no transaction is available', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    let released = false;
    const scopedRuntime = withConnection(runtime, () => {
      released = true;
    });

    await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime: scopedRuntime,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@example.com' } as never,
    });

    expect(released).toBe(true);
  });

  it('executeNestedCreateMutation() validates relation mutator input shapes', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: { kind: 'connect' },
        } as never,
      }),
    ).rejects.toThrow(/expects a mutator callback/);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: () => ({ invalid: true }),
        } as never,
      }),
    ).rejects.toThrow(/invalid mutation descriptor/);
  });

  it('executeNestedCreateMutation() rejects unsupported disconnect() in create graphs', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: { disconnect: () => unknown }) => author.disconnect(),
        } as never,
      }),
    ).rejects.toThrow(/disconnect\(\) is only supported in update\(\) nested mutations/);

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: (posts: { disconnect: () => unknown }) => posts.disconnect(),
        } as never,
      }),
    ).rejects.toThrow(/disconnect\(\) is only supported in update\(\) nested mutations/);
  });

  it('executeNestedCreateMutation() validates connect/create payloads for parent-owned relations', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: {
            connect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => author.connect([]),
        } as never,
      }),
    ).rejects.toThrow(/requires criterion/);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            author.connect({}),
        } as never,
      }),
    ).rejects.toThrow(/requires non-empty criterion/);

    runtime.setNextResults([[]]);
    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            author.connect({ id: 5 }),
        } as never,
      }),
    ).rejects.toThrow(/did not find a matching row/);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: { create: (data: readonly Record<string, unknown>[]) => unknown }) =>
            author.create([]),
        } as never,
      }),
    ).rejects.toThrow(/requires data/);
  });

  function findJunctionDml(
    runtime: MockRuntime,
    kind: 'insert' | 'delete',
    table: string,
  ): { kind: string; table: { name: string }; rows?: unknown; where?: unknown } {
    for (const execution of runtime.executions) {
      const ast = (execution.plan as { ast?: { kind: string; table?: { name: string } } }).ast;
      if (ast && ast.kind === kind && ast.table?.name === table) {
        return ast as { kind: string; table: { name: string }; rows?: unknown; where?: unknown };
      }
    }
    throw new Error(`no ${kind} on "${table}" found in executions`);
  }

  function collectLiterals(node: unknown): unknown[] {
    if (!node || typeof node !== 'object') {
      return [];
    }
    const expr = node as {
      kind?: string;
      value?: unknown;
      left?: unknown;
      right?: unknown;
      exprs?: readonly unknown[];
    };
    if (expr.kind === 'literal') {
      return [expr.value];
    }
    return [
      ...collectLiterals(expr.left),
      ...collectLiterals(expr.right),
      ...(expr.exprs ?? []).flatMap(collectLiterals),
    ];
  }

  it('executeNestedCreateMutation() routes M:N connect through a junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 10 }], [{ id: 1 }], [{ id: 10 }], []]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    expect(created).toEqual({ id: 1 });
    const insert = findJunctionDml(runtime, 'insert', 'parent_child');
    const junctionRow = (insert.rows as ReadonlyArray<Record<string, unknown>>)[0]!;
    expect(Object.keys(junctionRow).sort()).toEqual(['child_id', 'parent_id']);
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 10,
    ]);
  });

  it('executeNestedCreateMutation() routes M:N create through target INSERT then junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 20 }], []]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          children.create([{ id: 20 }]),
      } as never,
    });

    expect(created).toEqual({ id: 1 });
    const targetInsert = findJunctionDml(runtime, 'insert', 'children');
    expect(targetInsert.kind).toBe('insert');
    const link = (
      findJunctionDml(runtime, 'insert', 'parent_child').rows as ReadonlyArray<
        Record<string, unknown>
      >
    )[0]!;
    expect(Object.keys(link).sort()).toEqual(['child_id', 'parent_id']);
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 20,
    ]);
  });

  it('executeNestedCreateMutation() recurses junction-created targets through the nested-create graph', async () => {
    const contract = buildManyToManyContractWithTargetRelation();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 99 }], [{ id: 20, owner_id: 99 }], []]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          children.create([
            {
              id: 20,
              owner: (owner: { connect: (criterion: Record<string, unknown>) => unknown }) =>
                owner.connect({ id: 99 }),
            },
          ]),
      } as never,
    });

    expect(created).toEqual({ id: 1 });
    const unwrapRow = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([column, param]) => [column, (param as { value: unknown }).value]),
      );
    const childInsert = findJunctionDml(runtime, 'insert', 'children');
    expect(unwrapRow((childInsert.rows as ReadonlyArray<Record<string, unknown>>)[0]!)).toEqual({
      id: 20,
      owner_id: 99,
    });
    const link = (
      findJunctionDml(runtime, 'insert', 'parent_child').rows as ReadonlyArray<
        Record<string, unknown>
      >
    )[0]!;
    expect(unwrapRow(link)).toEqual({ parent_id: 1, child_id: 20 });
  });

  it('executeNestedCreateMutation() AND-s composite keys in the junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id', 'parent_id'],
      childColumns: ['tenant_id', 'child_id'],
      targetColumns: ['tenant_id', 'id'],
      localFields: ['tenant_id', 'id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ tenant_id: 7, id: 10 }],
      [{ tenant_id: 7, id: 1 }],
      [{ tenant_id: 7, id: 10 }],
      [],
    ]);

    await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        tenant_id: 7,
        id: 1,
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    const link = (
      findJunctionDml(runtime, 'insert', 'parent_child').rows as ReadonlyArray<
        Record<string, unknown>
      >
    )[0]!;
    expect(Object.keys(link).sort()).toEqual(['child_id', 'parent_id', 'tenant_id']);
  });

  // Mismatched junction column counts can't be authored — the contract-builder
  // rejects an M:N relation whose junction FK pairing is uneven before a
  // contract ever exists. These two cases exercise the defensive length guards
  // directly with a typed JunctionRelationDefinition (a guard input, not a
  // contract).
  function junctionRelationDefinition(
    through: Pick<JunctionRelationDefinition['through'], 'parentColumns' | 'childColumns'> & {
      readonly targetColumns: readonly string[];
    },
    columns: {
      readonly localColumns: readonly string[];
      readonly targetColumns: readonly string[];
    },
  ): JunctionRelationDefinition {
    return {
      relationName: 'children',
      relatedModelName: 'Child',
      relatedNamespaceId: 'public',
      relatedTableName: 'children',
      cardinality: 'N:M',
      localColumns: columns.localColumns,
      targetColumns: columns.targetColumns,
      through: {
        table: 'parent_child',
        namespaceId: 'public',
        parentColumns: through.parentColumns,
        childColumns: through.childColumns,
        targetColumns: through.targetColumns,
        requiredPayloadColumns: [],
      },
    };
  }

  it('assertJunctionParentMetadataLength() rejects mismatched junction parent-column metadata', () => {
    const relation = junctionRelationDefinition(
      {
        parentColumns: ['parent_id', 'tenant_id'],
        childColumns: ['child_id'],
        targetColumns: ['id'],
      },
      { localColumns: ['id'], targetColumns: ['id'] },
    );

    expect(() => assertJunctionParentMetadataLength(relation)).toThrow(
      /parentColumns.*localColumns/,
    );
  });

  it('assertJunctionTargetMetadataLength() rejects mismatched junction target-column metadata', () => {
    const relation = junctionRelationDefinition(
      {
        parentColumns: ['parent_id'],
        childColumns: ['child_id', 'tenant_id'],
        targetColumns: ['id'],
      },
      { localColumns: ['id'], targetColumns: ['id'] },
    );

    expect(() => assertJunctionTargetMetadataLength(relation)).toThrow(
      /childColumns.*targetColumns/,
    );
  });

  it('executeNestedCreateMutation() rejects duplicate resolved connect targets before any write', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 10 }], [{ id: 10 }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          id: 1,
          children: (children: {
            connect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => children.connect([{ id: 10 }, { id: 10 }]),
        } as never,
      }),
    ).rejects.toThrow(
      /connect\(\) nested mutation for relation "children" resolved duplicate junction link targets/,
    );

    const inserts = runtime.executions.filter(
      (execution) => (execution.plan as { ast?: { kind?: string } }).ast?.kind === 'insert',
    );
    expect(inserts).toEqual([]);
  });

  it('executeNestedCreateMutation() rejects conflicting values for shared junction columns', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id'],
      childColumns: ['tenant_id'],
      targetColumns: ['tenant_id'],
      localFields: ['tenant_id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ tenant_id: 8 }], [{ tenant_id: 7 }], [{ tenant_id: 8 }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          tenant_id: 7,
          children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            children.connect({ tenant_id: 8 }),
        } as never,
      }),
    ).rejects.toThrow(/conflicting values for junction column "tenant_id"/);
  });

  it('executeNestedUpdateMutation() routes M:N connect through a junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }], []]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
      data: {
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    const insert = findJunctionDml(runtime, 'insert', 'parent_child');
    expect(insert.kind).toBe('insert');
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 10,
    ]);
  });

  it('executeNestedUpdateMutation() wraps duplicate M:N connect errors', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    const execute = runtime.execute.bind(runtime);
    vi.spyOn(runtime, 'execute').mockImplementation((plan) => {
      const ast = (plan as { ast?: { kind: string; table?: { name: string } } }).ast;
      if (ast?.kind === 'insert' && ast.table?.name === 'parent_child') {
        throw new SqlQueryError(
          'duplicate key value violates unique constraint "parent_child_pkey"',
          {
            sqlState: UNIQUE_VIOLATION_SQLSTATE,
          },
        );
      }
      return execute(plan);
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
        data: {
          children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            children.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(
      /relation "children" violated a unique constraint on junction "parent_child"/,
    );
  });

  it('executeNestedUpdateMutation() passes a NOT NULL junction constraint failure through unwrapped', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    const execute = runtime.execute.bind(runtime);
    vi.spyOn(runtime, 'execute').mockImplementation((plan) => {
      const ast = (plan as { ast?: { kind: string; table?: { name: string } } }).ast;
      if (ast?.kind === 'insert' && ast.table?.name === 'parent_child') {
        // Drivers normalize a NOT NULL violation to sqlState 23502, not the
        // unique-violation 23505, so the connect wrap must leave it alone.
        throw new SqlQueryError('NOT NULL constraint failed: parent_child.level', {
          sqlState: '23502',
        });
      }
      return execute(plan);
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
        data: {
          children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            children.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(/NOT NULL constraint failed: parent_child\.level/);
  });

  it('executeNestedUpdateMutation() wraps a normalized unique violation regardless of message', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    const execute = runtime.execute.bind(runtime);
    vi.spyOn(runtime, 'execute').mockImplementation((plan) => {
      const ast = (plan as { ast?: { kind: string; table?: { name: string } } }).ast;
      if (ast?.kind === 'insert' && ast.table?.name === 'parent_child') {
        // Opaque message: recognition rides on the normalized sqlState alone,
        // so a primary-key violation (which drivers map to 23505) still wraps.
        throw new SqlQueryError('constraint violation', { sqlState: UNIQUE_VIOLATION_SQLSTATE });
      }
      return execute(plan);
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
        data: {
          children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            children.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(
      /relation "children" violated a unique constraint on junction "parent_child"/,
    );
  });

  it('executeNestedUpdateMutation() routes M:N disconnect through a junction DELETE', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], []]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
      data: {
        children: (children: {
          disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
        }) => children.disconnect([{ id: 10 }]),
      } as never,
    });

    const del = findJunctionDml(runtime, 'delete', 'parent_child');
    expect(del.kind).toBe('delete');
    expect(collectLiterals(del.where).sort()).toEqual([1, 10]);
  });

  it('executeNestedUpdateMutation() rejects conflicting values for shared junction columns on disconnect', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id'],
      childColumns: ['tenant_id'],
      targetColumns: ['tenant_id'],
      localFields: ['tenant_id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ tenant_id: 7 }], [{ tenant_id: 8 }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        filters: [BinaryExpr.eq(ColumnRef.of('parents', 'tenant_id'), LiteralExpr.of(7))],
        data: {
          children: (children: {
            disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => children.disconnect([{ tenant_id: 8 }]),
        } as never,
      }),
    ).rejects.toThrow(/conflicting values for junction column "tenant_id"/);

    const deletes = runtime.executions.filter(
      (execution) => (execution.plan as { ast?: { kind?: string } }).ast?.kind === 'delete',
    );
    expect(deletes).toEqual([]);
  });

  it('executeNestedUpdateMutation() emits a single predicate for shared junction columns with equal values', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id'],
      childColumns: ['tenant_id'],
      targetColumns: ['tenant_id'],
      localFields: ['tenant_id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ tenant_id: 7 }], [{ tenant_id: 7 }], []]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [BinaryExpr.eq(ColumnRef.of('parents', 'tenant_id'), LiteralExpr.of(7))],
      data: {
        children: (children: {
          disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
        }) => children.disconnect([{ tenant_id: 7 }]),
      } as never,
    });

    const del = findJunctionDml(runtime, 'delete', 'parent_child');
    expect(collectLiterals(del.where)).toEqual([7]);
  });

  it('executeNestedCreateMutation() rejects M:N disconnect (update-only)', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          id: 1,
          children: (children: {
            disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => children.disconnect([{ id: 10 }]),
        } as never,
      }),
    ).rejects.toThrow(/disconnect\(\) is only supported in update\(\) nested mutations/);
  });

  it('executeNestedCreateMutation() rejects M:N create when junction has required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          roles: (roles: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
            roles.create([{ id: 'admin' }]),
        } as never,
      }),
    ).rejects.toThrow(
      /Cannot `create` on relation `roles`: its junction `user_roles` has required column\(s\) `level`.*Write the `user_roles` junction directly or use the SQL builder\./,
    );
  });

  it('executeNestedCreateMutation() rejects M:N connect when junction has required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          roles: (roles: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            roles.connect({ id: 'admin' }),
        } as never,
      }),
    ).rejects.toThrow(
      /Cannot `connect` on relation `roles`: its junction `user_roles` has required column\(s\) `level`.*Write the `user_roles` junction directly or use the SQL builder\./,
    );
  });

  it('executeNestedCreateMutation() M:N connect applies the execution default to the junction row', async () => {
    // `level` is a NOT NULL junction payload column whose only default is an
    // execution-time onCreate generator (no storage default), authored through
    // the DSL via `field.generated`. The connect path must populate it before
    // the INSERT, mirroring insertJunctionLink.
    const contract = buildExecutionDefaultJunctionContract();
    // The defaults applier closes over the contract the context was created
    // from, so the context must be built from this contract — spreading
    // `{ ...getTestContext(), contract }` would never see the new default.
    const context = buildTestContextFromContract(contract, {
      mutationDefaultGenerators: [{ id: 'test-level', generate: () => 5, stability: 'field' }],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 'admin' }],
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'admin' }],
      [],
    ]);

    await executeNestedCreateMutation({
      context,
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        roles: (roles: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          roles.connect({ id: 'admin' }),
      } as never,
    });

    const insert = findJunctionDml(runtime, 'insert', 'user_roles');
    const junctionRow = (insert.rows as ReadonlyArray<Record<string, unknown>>)[0]!;
    expect(Object.keys(junctionRow).sort()).toEqual(['level', 'role_id', 'user_id']);
    expect((junctionRow['level'] as { value: unknown }).value).toBe(5);
  });

  it('executeNestedUpdateMutation() preflights junction guards before the scalar update', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          name: 'Alice Updated',
          roles: (roles: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            roles.connect({ id: 'admin' }),
        } as never,
      }),
    ).rejects.toThrow(
      /Cannot `connect` on relation `roles`: its junction `user_roles` has required column\(s\) `level`/,
    );

    const updates = runtime.executions.filter(
      (execution) => (execution.plan as { ast?: { kind?: string } }).ast?.kind === 'update',
    );
    expect(updates).toEqual([]);
  });

  it('executeNestedUpdateMutation() allows disconnect on junction with required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'admin' }],
      [],
    ]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        roles: (roles: { disconnect: (criteria: readonly Record<string, unknown>[]) => unknown }) =>
          roles.disconnect([{ id: 'admin' }]),
      } as never,
    });

    const del = findJunctionDml(runtime, 'delete', 'user_roles');
    expect(del.kind).toBe('delete');
  });

  it('executeNestedCreateMutation() allows M:N create on pure junction (no required payload)', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'ts' }],
      [],
    ]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        tags: (tags: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          tags.create([{ id: 'ts' }]),
      } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    const insert = findJunctionDml(runtime, 'insert', 'user_tags');
    expect(insert.kind).toBe('insert');
  });

  it('executeNestedCreateMutation() supports parent-owned nested create() payloads', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 5, name: 'Author', email: 'author@example.com' }],
      [{ id: 1, title: 'Post', user_id: 5, views: 1 }],
    ]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Post',
      data: {
        id: 1,
        title: 'Post',
        views: 1,
        author: (author: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          author.create([
            {
              id: 5,
              name: 'Author',
              email: 'author@example.com',
            },
          ]),
      } as never,
    });

    expect(created).toEqual({ id: 1, title: 'Post', userId: 5, views: 1 });
  });

  it('executeNestedCreateMutation() tolerates sparse parent/child column pairs', async () => {
    const contract = getTestContract();
    const sparseAuthorRelation = withPatchedDomainModels(contract, (models) => {
      const post = models['Post'] as { relations: { author: Record<string, unknown> } };
      return {
        ...models,
        Post: {
          ...post,
          relations: {
            ...post.relations,
            author: {
              ...post.relations.author,
              on: {
                localFields: [undefined, 'userId'] as unknown as readonly string[],
                targetFields: ['id', 'id'],
              },
            },
          },
        },
      };
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 5, name: 'Author', email: 'author@example.com' }],
      [{ id: 1, title: 'Post', user_id: 5, views: 1 }],
    ]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract: sparseAuthorRelation },
      runtime,
      namespaceId: 'public',
      modelName: 'Post',
      data: {
        id: 1,
        title: 'Post',
        views: 1,
        author: (author: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          author.connect({ id: 5 }),
      } as never,
    });

    expect(created).toEqual({ id: 1, title: 'Post', userId: 5, views: 1 });
  });

  it('executeNestedUpdateMutation() returns null when no row matches filters', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);

    const updated = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: { name: 'Alice Updated' } as never,
    });

    expect(updated).toBeNull();
  });

  it('executeNestedUpdateMutation() applies parent-owned disconnect updates', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, title: 'Post', user_id: 5, views: 10 }],
      [{ id: 1, title: 'Post', user_id: null, views: 10 }],
    ]);

    const updated = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Post',
      filters: [postIdFilter],
      data: {
        author: (author: { disconnect: () => unknown }) => author.disconnect(),
      } as never,
    });

    expect(updated).toEqual({ id: 1, title: 'Post', userId: null, views: 10 });
  });

  it('executeNestedUpdateMutation() keeps existing rows when update-returning returns no row', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);

    const updated = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: { name: 'Updated' } as never,
    });

    expect(updated).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('executeNestedUpdateMutation() validates child-owned connect and disconnect criteria', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          posts: (posts: { connect: (criteria: readonly Record<string, unknown>[]) => unknown }) =>
            posts.connect([{}]),
        } as never,
      }),
    ).rejects.toThrow(/requires non-empty criterion/);

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);
    const connected = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 11 }),
      } as never,
    });

    expect(connected).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);
    const disconnected = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        posts: (posts: { disconnect: () => unknown }) => posts.disconnect(),
      } as never,
    });

    expect(disconnected).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          posts: (posts: {
            disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => posts.disconnect([{}]),
        } as never,
      }),
    ).rejects.toThrow(/requires non-empty criterion/);
  });

  it('executeNestedUpdateMutation() supports composite child joins and sparse relation columns', async () => {
    const contract = getTestContract();
    const compositeRelationContract = withPatchedDomainModels(contract, (models) => {
      const user = models['User'] as { relations: { posts: Record<string, unknown> } };
      return {
        ...models,
        User: {
          ...user,
          relations: {
            ...user.relations,
            posts: {
              ...user.relations.posts,
              on: {
                localFields: [undefined, 'id', 'email'] as unknown as readonly string[],
                targetFields: ['userId', 'userId', 'title'],
              },
            },
          },
        },
      };
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);

    const updated = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract: compositeRelationContract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        posts: (posts: { disconnect: () => unknown }) => posts.disconnect(),
      } as never,
    });

    expect(updated).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('executeNestedUpdateMutation() validates parent row shape for child-owned mutations', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            posts.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(/requires parent field "id"/);
  });

  it('executeNestedCreateMutation() reuses scope directly when runtime lacks transaction and connection', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@test.com' }]]);

    const querySpy = vi.spyOn(runtime, 'query');

    const created = await executeNestedCreateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@test.com' } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com' });
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it('withMutationScope reuses runtime directly when no transaction or connection method exists', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@test.com' }]]);

    expect(runtime.transaction).toBeUndefined();
    expect(runtime.connection).toBeUndefined();

    const created = await executeNestedCreateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@test.com' } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com' });
    expect(runtime.executions).toHaveLength(1);
  });
});
