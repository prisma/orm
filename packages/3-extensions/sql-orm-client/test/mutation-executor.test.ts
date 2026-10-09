import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { SqlQueryError, UNIQUE_VIOLATION_SQLSTATE } from '@internal/sql-errors';
import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  OrExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRowIdentityFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
} from '../src/mutation-executor';
import {
  assertJunctionParentMetadataLength,
  assertJunctionTargetMetadataLength,
  type JunctionRelationDefinition,
} from '../src/relation-definitions';
import { defineContract, field, model, rel } from './contract-builder';
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
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }]]);

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

  it('executeNestedCreateMutation() looks up and inserts a junction link for each criterion when a connect names a target twice', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }]]);

    await executeNestedCreateMutation({
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
    });

    expect(statementTrace(runtime)).toEqual([
      'insert parents',
      'select children',
      'insert parent_child',
      'select children',
      'insert parent_child',
    ]);
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
    runtime.setNextResults([[{ tenant_id: 7 }], [{ tenant_id: 8 }]]);

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
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }]]);

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

  it('executeNestedUpdateMutation() passes a unique violation on the junction insert of a connect through unchanged', async () => {
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
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }]]);

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
    ).rejects.toMatchObject({
      message: 'duplicate key value violates unique constraint "parent_child_pkey"',
      sqlState: UNIQUE_VIOLATION_SQLSTATE,
    });
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
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }]]);

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
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'admin' }],
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

  interface LooseMutator {
    create(data: unknown): unknown;
    connect(criteria: unknown): unknown;
    disconnect(criteria?: unknown): unknown;
    where(filter: unknown): LooseFilteredMutator;
    updateAll(data: unknown): unknown;
    deleteAll(): unknown;
  }

  interface LooseFilteredMutator {
    where(filter: unknown): LooseFilteredMutator;
    updateAll(data: unknown): unknown;
    deleteAll(): unknown;
  }

  interface LoosePostAccessor {
    views: { gt(value: number): AnyExpression };
    title: { eq(value: string): AnyExpression };
  }

  function statementTrace(runtime: MockRuntime): string[] {
    return runtime.executions.map((execution) => {
      const ast = (
        execution.plan as {
          ast: { kind: string; table?: { name: string }; from?: { name: string } };
        }
      ).ast;
      return `${ast.kind} ${(ast.table ?? ast.from)?.name}`;
    });
  }

  function statementValues(
    runtime: MockRuntime,
  ): { params: readonly unknown[]; where: unknown[] }[] {
    return runtime.executions.map((execution) => {
      const plan = execution.plan as { params: readonly unknown[]; ast: { where?: unknown } };
      return { params: plan.params, where: collectLiterals(plan.ast.where) };
    });
  }

  function manyToManyContract() {
    return buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
  }

  const parentIdFilter: AnyExpression = BinaryExpr.eq(
    ColumnRef.of('parents', 'id'),
    LiteralExpr.of(1),
  );

  it('executeNestedUpdateMutation() applies an array of operations on one relation in array order', async () => {
    const disconnectThenConnect = createMockRuntime();
    disconnectThenConnect.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }], [{ id: 10 }]]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract: manyToManyContract() },
      runtime: disconnectThenConnect,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [parentIdFilter],
      data: {
        children: (children: LooseMutator) => [
          children.disconnect([{ id: 10 }]),
          children.connect({ id: 10 }),
        ],
      } as never,
    });

    expect(
      statementTrace(disconnectThenConnect).filter((entry) => entry.endsWith('parent_child')),
    ).toEqual(['delete parent_child', 'insert parent_child']);

    const connectThenDisconnect = createMockRuntime();
    connectThenDisconnect.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }], [{ id: 10 }]]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract: manyToManyContract() },
      runtime: connectThenDisconnect,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [parentIdFilter],
      data: {
        children: (children: LooseMutator) => [
          children.connect({ id: 10 }),
          children.disconnect([{ id: 10 }]),
        ],
      } as never,
    });

    expect(
      statementTrace(connectThenDisconnect).filter((entry) => entry.endsWith('parent_child')),
    ).toEqual(['insert parent_child', 'delete parent_child']);
  });

  it('executeNestedUpdateMutation() applies three operations on a child-owned relation in array order', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 20, title: 'New', user_id: 1, views: 0 }],
    ]);

    const updated = await executeNestedUpdateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        posts: (posts: LooseMutator) => [
          posts.disconnect(),
          posts.create({ id: 20, title: 'New', views: 0 }),
          posts.connect({ id: 11 }),
        ],
      } as never,
    });

    expect(updated).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(statementTrace(runtime)).toEqual([
      'select users',
      'update posts',
      'insert posts',
      'update posts',
    ]);
    expect(statementValues(runtime)[1]).toEqual({ params: [null], where: [1] });
    expect(statementValues(runtime)[3]).toEqual({ params: [1], where: [11] });
  });

  it('executeNestedUpdateMutation() lets the last operation in an array decide a parent-owned relation', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, title: 'Post', user_id: 5, views: 10 }],
      [{ id: 7, name: 'Bob', email: 'bob@example.com' }],
      [{ id: 1, title: 'Post', user_id: null, views: 10 }],
    ]);

    const updated = await executeNestedUpdateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'Post',
      filters: [postIdFilter],
      data: {
        author: (author: LooseMutator) => [author.connect({ id: 7 }), author.disconnect()],
      } as never,
    });

    expect(updated).toEqual({ id: 1, title: 'Post', userId: null, views: 10 });
    expect(statementTrace(runtime)).toEqual(['select posts', 'select users', 'update posts']);
    expect(statementValues(runtime)[2]).toEqual({ params: [null], where: [1] });
  });

  it('executeNestedCreateMutation() applies an array of operations on one relation in array order', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 20, title: 'New', user_id: 1, views: 0 }],
    ]);

    const created = await executeNestedCreateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        posts: (posts: LooseMutator) => [
          posts.connect({ id: 11 }),
          posts.create({ id: 20, title: 'New', views: 0 }),
          posts.connect({ id: 12 }),
        ],
      } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(statementTrace(runtime)).toEqual([
      'insert users',
      'update posts',
      'insert posts',
      'update posts',
    ]);
    expect(statementValues(runtime)[1]).toEqual({ params: [1], where: [11] });
    expect(statementValues(runtime)[3]).toEqual({ params: [1], where: [12] });
  });

  it('executeNestedUpdateMutation() treats an empty array as no relation operation', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const updated = await executeNestedUpdateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: { posts: () => [] } as never,
    });

    expect(updated).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(statementTrace(runtime)).toEqual(['select users']);
  });

  it('executeNestedCreateMutation() rejects disconnect() inside an array on every relation layout', async () => {
    const parentOwned = createMockRuntime();
    parentOwned.setNextResults([[{ id: 7, name: 'Bob', email: 'bob@example.com' }]]);
    await expect(
      executeNestedCreateMutation({
        context: getTestContext(),
        runtime: parentOwned,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: LooseMutator) => [author.connect({ id: 7 }), author.disconnect()],
        } as never,
      }),
    ).rejects.toMatchObject({
      code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
      meta: { kind: 'disconnect', relation: 'author' },
    });

    const childOwned = createMockRuntime();
    childOwned.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    await expect(
      executeNestedCreateMutation({
        context: getTestContext(),
        runtime: childOwned,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: (posts: LooseMutator) => [posts.connect({ id: 11 }), posts.disconnect()],
        } as never,
      }),
    ).rejects.toMatchObject({
      code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
      meta: { kind: 'disconnect', relation: 'posts' },
    });

    const junctionOwned = createMockRuntime();
    junctionOwned.setNextResults([[{ id: 10 }]]);
    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract: manyToManyContract() },
        runtime: junctionOwned,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          id: 1,
          children: (children: LooseMutator) => [
            children.connect({ id: 10 }),
            children.disconnect([{ id: 10 }]),
          ],
        } as never,
      }),
    ).rejects.toMatchObject({
      code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
      meta: { kind: 'disconnect', relation: 'children' },
    });
  });

  const aliceRow = { id: 1, name: 'Alice', email: 'alice@example.com' };

  async function updateAlicePosts(
    posts: (mutator: LooseMutator) => unknown,
    context = getTestContext(),
  ): Promise<MockRuntime> {
    const runtime = createMockRuntime();
    runtime.setNextResults([[aliceRow], [{ id: 20, title: 'New', user_id: 1, views: 0 }]]);
    await executeNestedUpdateMutation({
      context,
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: { posts } as never,
    });
    return runtime;
  }

  function twoForeignKeyContract() {
    const Owner = model('Owner', {
      fields: { id: field.column(int4Column).id() },
    }).sql({ table: 'owners' });
    const Parent = model('Parent', {
      fields: { id: field.column(int4Column).id() },
    }).sql({ table: 'parents' });
    const Child = model('Child', {
      fields: {
        id: field.column(int4Column).id(),
        parentId: field.column(int4Column).column('parent_id'),
        ownerId: field.column(int4Column).column('owner_id'),
      },
      relations: {
        owner: rel.belongsTo(Owner, { from: 'ownerId', to: 'id' }),
      },
    }).sql({ table: 'children' });
    return defineContract({
      models: {
        Owner,
        Parent: Parent.relations({
          children: rel.hasMany(() => Child, { by: 'parentId' }),
        }).sql({ table: 'parents' }),
        Child,
      },
    });
  }

  it('updateAll() with a shorthand where updates only matching rows of the parent', async () => {
    const runtime = await updateAlicePosts((posts) =>
      posts.where({ title: 'Draft' }).updateAll({ views: 5 }),
    );

    expect(statementTrace(runtime)).toEqual(['select users', 'update posts']);
    expect(statementValues(runtime)[1]).toEqual({ params: [5, 'Draft'], where: [1] });
  });

  it('deleteAll() with a callback where deletes only matching rows of the parent', async () => {
    const runtime = await updateAlicePosts((posts) =>
      posts.where((post: LoosePostAccessor) => post.views.gt(10)).deleteAll(),
    );

    expect(statementTrace(runtime)).toEqual(['select users', 'delete posts']);
    expect(statementValues(runtime)[1]).toEqual({ params: [10], where: [1] });
  });

  it('where() accepts a direct expression', async () => {
    const runtime = await updateAlicePosts((posts) =>
      posts.where(BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(7))).deleteAll(),
    );

    expect(statementTrace(runtime)).toEqual(['select users', 'delete posts']);
    expect(statementValues(runtime)[1]).toEqual({ params: [7], where: [1] });
  });

  it('chained where() calls combine with AND', async () => {
    const runtime = await updateAlicePosts((posts) =>
      posts.where({ title: 'Draft' }).where({ views: 3 }).updateAll({ title: 'Published' }),
    );

    expect(statementTrace(runtime)).toEqual(['select users', 'update posts']);
    expect(statementValues(runtime)[1]).toEqual({
      params: ['Published', 'Draft', 3],
      where: [1],
    });
  });

  it('updateAll() and deleteAll() without where apply to every row of the parent', async () => {
    const runtime = await updateAlicePosts((posts) => [
      posts.updateAll({ views: 0 }),
      posts.deleteAll(),
    ]);

    expect(statementTrace(runtime)).toEqual(['select users', 'update posts', 'delete posts']);
    expect(statementValues(runtime).slice(1)).toEqual([
      { params: [0], where: [1] },
      { params: [], where: [1] },
    ]);
  });

  it('updateAll() applies the update defaults of the related model', async () => {
    const defaultCalls: unknown[] = [];
    const context = {
      ...getTestContext(),
      applyMutationDefaults: (options: {
        op: string;
        entry: string;
        namespace: string;
        values: Record<string, unknown>;
      }) => {
        defaultCalls.push({ op: options.op, entry: options.entry, namespace: options.namespace });
        return [{ field: 'views', value: 99 }];
      },
    } as ReturnType<typeof getTestContext>;

    const runtime = await updateAlicePosts(
      (posts) => posts.where({ title: 'Draft' }).updateAll({ title: 'Published' }),
      context,
    );

    expect(defaultCalls).toEqual([{ op: 'update', entry: 'posts', namespace: 'public' }]);
    expect(statementValues(runtime)[1]).toEqual({
      params: ['Published', 99, 'Draft'],
      where: [1],
    });
  });

  it('updateAll() with empty data issues no statement', async () => {
    const runtime = await updateAlicePosts((posts) => [
      posts.updateAll({}),
      posts.where({ title: 'Draft' }).updateAll({ views: undefined }),
    ]);

    expect(statementTrace(runtime)).toEqual(['select users']);
  });

  it('updateAll() and deleteAll() run in array order with create()', async () => {
    const runtime = await updateAlicePosts((posts) => [
      posts.deleteAll(),
      posts.create({ id: 20, title: 'New', views: 0 }),
      posts.where({ title: 'New' }).updateAll({ views: 1 }),
    ]);

    expect(statementTrace(runtime)).toEqual([
      'select users',
      'delete posts',
      'insert posts',
      'update posts',
    ]);
  });

  it('updateAll() may set the foreign key of another relation', async () => {
    const contract = twoForeignKeyContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }]]);

    await executeNestedUpdateMutation({
      context: buildTestContextFromContract(contract),
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [parentIdFilter],
      data: {
        children: (children: LooseMutator) => children.updateAll({ ownerId: 7 }),
      } as never,
    });

    expect(statementTrace(runtime)).toEqual(['select parents', 'update children']);
    expect(statementValues(runtime)[1]).toEqual({ params: [7], where: [1] });
  });

  it('a where() returned without updateAll() or deleteAll() is rejected as malformed', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[aliceRow]]);

    await expect(
      executeNestedUpdateMutation({
        context: getTestContext(),
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: { posts: (posts: LooseMutator) => posts.where({ title: 'Draft' }) } as never,
      }),
    ).rejects.toMatchObject({
      code: 'ORM.RELATION_MUTATION_INVALID',
      meta: { relation: 'posts', model: 'User', problem: 'invalid-descriptor' },
    });
  });

  it('executeNestedCreateMutation() rejects updateAll() and deleteAll() on to-one and many-to-many relations as update-only', async () => {
    const parentOwned = createMockRuntime();
    await expect(
      executeNestedCreateMutation({
        context: getTestContext(),
        runtime: parentOwned,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: LooseMutator) => author.deleteAll(),
        } as never,
      }),
    ).rejects.toMatchObject({
      code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
      message: 'deleteAll() is only supported in update() nested mutations',
    });
    expect(parentOwned.executions).toEqual([]);

    const junctionOwned = createMockRuntime();
    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract: manyToManyContract() },
        runtime: junctionOwned,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          id: 1,
          children: (children: LooseMutator) => children.updateAll({ id: 2 }),
        } as never,
      }),
    ).rejects.toMatchObject({
      code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
      message: 'updateAll() is only supported in update() nested mutations',
    });
    expect(junctionOwned.executions).toEqual([]);
  });

  type WhereShape =
    | string
    | { kind: string; exprs: WhereShape[] }
    | { kind: 'exists'; negated: boolean; from: string; where: WhereShape };

  function whereShape(node: unknown): WhereShape {
    const expr = node as {
      kind: string;
      exprs?: readonly unknown[];
      op?: string;
      left?: { table: string; column: string };
      right?: { kind: string; value?: unknown; table?: string; column?: string };
      notExists?: boolean;
      subquery?: { from: { name: string }; where: unknown };
    };
    if (expr.subquery) {
      return {
        kind: 'exists',
        negated: expr.notExists === true,
        from: expr.subquery.from.name,
        where: whereShape(expr.subquery.where),
      };
    }
    if (expr.exprs) {
      return { kind: expr.kind, exprs: expr.exprs.map(whereShape) };
    }
    const right =
      expr.right?.kind === 'column-ref'
        ? `${expr.right.table}.${expr.right.column}`
        : String(expr.right?.value);
    return `${expr.left?.table}.${expr.left?.column} ${expr.op} ${right}`;
  }

  function statementWhere(runtime: MockRuntime, index: number): WhereShape {
    return whereShape((runtime.executions[index]!.plan as { ast: { where: unknown } }).ast.where);
  }

  const draftOrPopular = (post: LoosePostAccessor) =>
    OrExpr.of([post.title.eq('Draft'), post.views.gt(10)]);

  const parentAndWholeOr: WhereShape = {
    kind: 'and',
    exprs: [
      'posts.user_id eq 1',
      { kind: 'or', exprs: ['posts.title eq Draft', 'posts.views gt 10'] },
    ],
  };

  it('updateAll() ANDs the parent condition with a whole OR filter', async () => {
    const runtime = await updateAlicePosts((posts) =>
      posts.where(draftOrPopular).updateAll({ views: 0 }),
    );

    expect(statementTrace(runtime)).toEqual(['select users', 'update posts']);
    expect(statementWhere(runtime, 1)).toEqual(parentAndWholeOr);
  });

  it('deleteAll() ANDs the parent condition with a whole OR filter', async () => {
    const runtime = await updateAlicePosts((posts) => posts.where(draftOrPopular).deleteAll());

    expect(statementTrace(runtime)).toEqual(['select users', 'delete posts']);
    expect(statementWhere(runtime, 1)).toEqual(parentAndWholeOr);
  });

  it('an OR filter chained with another where() stays one operand of the AND', async () => {
    const runtime = await updateAlicePosts((posts) =>
      posts.where(draftOrPopular).where({ title: 'Kept' }).deleteAll(),
    );

    expect(statementWhere(runtime, 1)).toEqual({
      kind: 'and',
      exprs: [
        'posts.user_id eq 1',
        { kind: 'or', exprs: ['posts.title eq Draft', 'posts.views gt 10'] },
        'posts.title eq Kept',
      ],
    });
  });

  interface LooseChildAccessor {
    id: { eq(value: number): AnyExpression; gt(value: number): AnyExpression };
  }

  async function updateParentChildren(
    children: (mutator: LooseMutator) => unknown,
    context: Parameters<typeof executeNestedUpdateMutation>[0]['context'] = {
      ...getTestContext(),
      contract: manyToManyContract(),
    },
    results: Record<string, unknown>[][] = [[{ id: 1 }]],
  ): Promise<MockRuntime> {
    const runtime = createMockRuntime();
    runtime.setNextResults(results);
    await executeNestedUpdateMutation({
      context,
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [parentIdFilter],
      data: { children } as never,
    });
    return runtime;
  }

  const linkedToParentOne: WhereShape = {
    kind: 'exists',
    negated: false,
    from: 'parent_child',
    where: {
      kind: 'and',
      exprs: ['parent_child.parent_id eq 1', 'parent_child.child_id eq children.id'],
    },
  };

  it('many-to-many updateAll() without where is limited to targets linked to the parent', async () => {
    const runtime = await updateParentChildren((children) => children.updateAll({ id: 11 }));

    expect(statementTrace(runtime)).toEqual(['select parents', 'update children']);
    expect(statementWhere(runtime, 1)).toEqual(linkedToParentOne);
    expect(statementValues(runtime)[1]?.params).toEqual([11]);
  });

  it('many-to-many deleteAll() without where is limited to targets linked to the parent and issues no junction statement', async () => {
    const runtime = await updateParentChildren((children) => children.deleteAll());

    expect(statementTrace(runtime)).toEqual(['select parents', 'delete children']);
    expect(statementWhere(runtime, 1)).toEqual(linkedToParentOne);
  });

  const tenOrAboveTwenty = (child: LooseChildAccessor) =>
    OrExpr.of([child.id.eq(10), child.id.gt(20)]);

  const linkedAndWholeOr: WhereShape = {
    kind: 'and',
    exprs: [linkedToParentOne, { kind: 'or', exprs: ['children.id eq 10', 'children.id gt 20'] }],
  };

  it('many-to-many updateAll() ANDs the junction condition with a whole OR filter', async () => {
    const runtime = await updateParentChildren((children) =>
      children.where(tenOrAboveTwenty).updateAll({ id: 11 }),
    );

    expect(statementTrace(runtime)).toEqual(['select parents', 'update children']);
    expect(statementWhere(runtime, 1)).toEqual(linkedAndWholeOr);
  });

  it('many-to-many deleteAll() ANDs the junction condition with a whole OR filter', async () => {
    const runtime = await updateParentChildren((children) =>
      children.where(tenOrAboveTwenty).deleteAll(),
    );

    expect(statementTrace(runtime)).toEqual(['select parents', 'delete children']);
    expect(statementWhere(runtime, 1)).toEqual(linkedAndWholeOr);
  });

  it('many-to-many deleteAll() matches every column of a composite junction key', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id', 'parent_id'],
      childColumns: ['tenant_id', 'child_id'],
      targetColumns: ['tenant_id', 'id'],
      localFields: ['tenant_id', 'id'],
    });
    const runtime = await updateParentChildren(
      (children) => children.where({ id: 10 }).deleteAll(),
      { ...getTestContext(), contract },
      [[{ tenant_id: 7, id: 1 }]],
    );

    expect(statementTrace(runtime)).toEqual(['select parents', 'delete children']);
    expect(statementWhere(runtime, 1)).toEqual({
      kind: 'and',
      exprs: [
        {
          kind: 'exists',
          negated: false,
          from: 'parent_child',
          where: {
            kind: 'and',
            exprs: [
              'parent_child.tenant_id eq 7',
              'parent_child.parent_id eq 1',
              'parent_child.tenant_id eq children.tenant_id',
              'parent_child.child_id eq children.id',
            ],
          },
        },
        'children.id eq 10',
      ],
    });
  });

  it('many-to-many updateAll() and deleteAll() run in array order with disconnect()', async () => {
    const runtime = await updateParentChildren(
      (children) => [
        children.updateAll({ id: 11 }),
        children.disconnect([{ id: 10 }]),
        children.deleteAll(),
      ],
      undefined,
      [[{ id: 1 }], [{ id: 10 }]],
    );

    expect(statementTrace(runtime)).toEqual([
      'select parents',
      'update children',
      'select children',
      'delete parent_child',
      'delete children',
    ]);
  });

  it('many-to-many connect() in update() looks up each target after the parent update and inserts its link before the next lookup', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 2 }], [{ id: 10 }], [{ id: 11 }]]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract: manyToManyContract() },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [parentIdFilter],
      data: {
        id: 2,
        children: (children: LooseMutator) => children.connect([{ id: 10 }, { id: 11 }]),
      } as never,
    });

    expect(statementTrace(runtime)).toEqual([
      'select parents',
      'update parents',
      'select children',
      'insert parent_child',
      'select children',
      'insert parent_child',
    ]);
    expect(statementValues(runtime).map((statement) => statement.params)).toEqual([
      [1],
      [2],
      [10],
      [2, 10],
      [11],
      [2, 11],
    ]);
  });

  it('many-to-many connect() in create() looks up its target after the parent insert', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }]]);

    await executeNestedCreateMutation({
      context: { ...getTestContext(), contract: manyToManyContract() },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: LooseMutator) => children.connect({ id: 10 }),
      } as never,
    });

    expect(statementTrace(runtime)).toEqual([
      'insert parents',
      'select children',
      'insert parent_child',
    ]);
  });

  function keylessJunctionContract() {
    const Parent = model('Parent', { fields: { id: field.column(int4Column).id() } });
    const Child = model('Child', { fields: { id: field.column(int4Column).id() } }).sql({
      table: 'children',
    });
    const Junction = model('Junction', {
      fields: {
        parentId: field.column(int4Column).column('parent_id'),
        childId: field.column(int4Column).column('child_id'),
      },
    }).sql({ table: 'parent_child' });
    return defineContract({
      models: {
        Parent: Parent.relations({
          children: rel.manyToMany(() => Child, {
            through: () => Junction,
            from: 'parentId',
            to: 'childId',
          }),
        }).sql({ table: 'parents' }),
        Child,
        Junction,
      },
    });
  }

  async function connectChildren(
    contract: object,
    criteria: readonly Record<string, unknown>[],
    targets: Record<string, unknown>[],
  ): Promise<MockRuntime> {
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], ...targets.map((target) => [target])]);
    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract } as never,
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [parentIdFilter],
      data: { children: (children: LooseMutator) => children.connect(criteria) } as never,
    });
    return runtime;
  }

  function junctionInsertConflict(runtime: MockRuntime): unknown {
    const insert = findJunctionDml(runtime, 'insert', 'parent_child') as {
      onConflict?: { columns: readonly { column: string }[]; action: { kind: string } };
    };
    return (
      insert.onConflict && {
        columns: insert.onConflict.columns.map((column) => column.column),
        action: insert.onConflict.action.kind,
      }
    );
  }

  it('many-to-many connect() inserts the junction row with a do-nothing conflict clause on the link columns when the junction has a key over them', async () => {
    const runtime = await connectChildren(manyToManyContract(), [{ id: 10 }], [{ id: 10 }]);

    expect(junctionInsertConflict(runtime)).toEqual({
      columns: ['parent_id', 'child_id'],
      action: 'do-nothing',
    });
  });

  it('many-to-many connect() inserts the junction row without a conflict clause when the junction has no key over the link columns', async () => {
    const runtime = await connectChildren(keylessJunctionContract(), [{ id: 10 }], [{ id: 10 }]);

    expect(junctionInsertConflict(runtime)).toBeUndefined();
  });

  it('many-to-many connect() on a junction with no key inserts a junction row for each criterion that resolves to the same target', async () => {
    const runtime = await connectChildren(
      keylessJunctionContract(),
      [{ id: 10 }, { id: 11 }],
      [{ id: 10 }, { id: 10 }],
    );

    expect(statementTrace(runtime)).toEqual([
      'select parents',
      'select children',
      'insert parent_child',
      'select children',
      'insert parent_child',
    ]);
    expect(
      statementValues(runtime)
        .map((statement) => statement.params)
        .filter((_, index) => index === 2 || index === 4),
    ).toEqual([
      [1, 10],
      [1, 10],
    ]);
  });

  interface NoRowCase {
    readonly name: string;
    readonly modelName: string;
    readonly filter: AnyExpression;
    readonly contract?: ReturnType<typeof manyToManyContract>;
    readonly data: unknown;
    readonly expected: { code: string; meta?: Record<string, unknown> };
  }

  const invalidNestedInputCases: readonly NoRowCase[] = [
    {
      name: 'a relation field that is not a callback',
      modelName: 'User',
      filter: userIdFilter,
      data: { posts: { kind: 'connect' } },
      expected: { code: 'ORM.RELATION_MUTATION_INVALID', meta: { problem: 'missing-callback' } },
    },
    {
      name: 'a callback returning something that is not an operation',
      modelName: 'User',
      filter: userIdFilter,
      data: { posts: () => ({ invalid: true }) },
      expected: { code: 'ORM.RELATION_MUTATION_INVALID', meta: { problem: 'invalid-descriptor' } },
    },
    {
      name: 'a nested array of operations',
      modelName: 'User',
      filter: userIdFilter,
      data: { posts: (posts: LooseMutator) => [[posts.disconnect()]] },
      expected: { code: 'ORM.RELATION_MUTATION_INVALID', meta: { problem: 'nested-array' } },
    },
    {
      name: 'an array element that is not an operation',
      modelName: 'User',
      filter: userIdFilter,
      data: { posts: (posts: LooseMutator) => [posts.disconnect(), null] },
      expected: {
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { problem: 'invalid-descriptor', index: 1 },
      },
    },
    {
      name: 'updateAll() on a to-one relation the parent owns',
      modelName: 'Post',
      filter: postIdFilter,
      data: { author: (author: LooseMutator) => author.updateAll({ name: 'Bob' }) },
      expected: {
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        meta: { kind: 'updateAll', reason: 'to-one-relation' },
      },
    },
    {
      name: 'deleteAll() on a to-one relation the child owns',
      modelName: 'User',
      filter: userIdFilter,
      data: { profile: (profile: LooseMutator) => profile.where({ id: 1 }).deleteAll() },
      expected: {
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        meta: { kind: 'deleteAll', reason: 'to-one-relation' },
      },
    },
    {
      name: 'updateAll() data that sets the column linking the child to the parent',
      modelName: 'User',
      filter: userIdFilter,
      data: { posts: (posts: LooseMutator) => posts.updateAll({ userId: 2 }) },
      expected: {
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { problem: 'parent-link-column', fields: ['userId'] },
      },
    },
    {
      name: 'a where() callback that returns null',
      modelName: 'User',
      filter: userIdFilter,
      data: { posts: (posts: LooseMutator) => posts.where(() => null).deleteAll() },
      expected: { code: 'ORM.ARGUMENT_INVALID' },
    },
    {
      name: 'disconnect() without criteria on a many-to-many relation',
      modelName: 'Parent',
      filter: parentIdFilter,
      contract: manyToManyContract(),
      data: { children: (children: LooseMutator) => children.disconnect() },
      expected: {
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { kind: 'disconnect', problem: 'missing-criterion' },
      },
    },
    {
      name: 'connect() through a junction with required payload columns',
      modelName: 'User',
      filter: userIdFilter,
      data: { roles: (roles: LooseMutator) => roles.connect({ id: 'admin' }) },
      expected: {
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        meta: { kind: 'connect', reason: 'junction-required-columns' },
      },
    },
    {
      name: 'connect() with an empty criterion on a many-to-many relation',
      modelName: 'Parent',
      filter: parentIdFilter,
      contract: manyToManyContract(),
      data: { children: (children: LooseMutator) => children.connect({}) },
      expected: { code: 'ORM.RELATION_MUTATION_INVALID', meta: { problem: 'empty-criterion' } },
    },
    {
      name: 'create() without data on a to-one relation the parent owns',
      modelName: 'Post',
      filter: postIdFilter,
      data: { author: (author: LooseMutator) => author.create([]) },
      expected: {
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { kind: 'create', problem: 'missing-data' },
      },
    },
    {
      name: 'connect() without a criterion on a to-one relation the parent owns',
      modelName: 'Post',
      filter: postIdFilter,
      data: { author: (author: LooseMutator) => author.connect([]) },
      expected: {
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { kind: 'connect', problem: 'missing-criterion' },
      },
    },
    {
      name: 'connect() with an empty criterion on a to-one relation the parent owns',
      modelName: 'Post',
      filter: postIdFilter,
      data: { author: (author: LooseMutator) => author.connect({}) },
      expected: { code: 'ORM.RELATION_MUTATION_INVALID', meta: { problem: 'empty-criterion' } },
    },
    {
      name: 'connect() with an empty criterion on a one-to-many relation',
      modelName: 'User',
      filter: userIdFilter,
      data: { posts: (posts: LooseMutator) => posts.connect([{}]) },
      expected: {
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { kind: 'connect', problem: 'empty-criterion' },
      },
    },
    {
      name: 'a nested create() whose own relation field is not a callback',
      modelName: 'User',
      filter: userIdFilter,
      data: {
        posts: (posts: LooseMutator) =>
          posts.create({ id: 20, title: 'New', views: 0, comments: { kind: 'create' } }),
      },
      expected: {
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { relation: 'comments', model: 'Post', problem: 'missing-callback' },
      },
    },
    {
      name: 'a nested create() that contains disconnect()',
      modelName: 'User',
      filter: userIdFilter,
      data: {
        posts: (posts: LooseMutator) =>
          posts.create({
            id: 20,
            title: 'New',
            views: 0,
            comments: (comments: LooseMutator) => comments.disconnect(),
          }),
      },
      expected: {
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        meta: { kind: 'disconnect', relation: 'comments' },
      },
    },
  ];

  it.each(invalidNestedInputCases)(
    'executeNestedUpdateMutation() rejects $name before it looks up the row',
    async ({ modelName, filter, contract, data, expected }) => {
      const context = contract ? { ...getTestContext(), contract } : getTestContext();

      const noRow = createMockRuntime();
      noRow.setNextResults([[]]);
      await expect(
        executeNestedUpdateMutation({
          context,
          runtime: noRow,
          namespaceId: 'public',
          modelName,
          filters: [filter],
          data: data as never,
        }),
      ).rejects.toMatchObject(expected);
      expect(noRow.executions).toEqual([]);
    },
  );

  it('executeNestedUpdateMutation() with valid nested input and no matching row resolves null and writes nothing', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);

    const updated = await executeNestedUpdateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        name: 'Renamed',
        posts: (posts: LooseMutator) => [
          posts.create({ id: 20, title: 'New', views: 0 }),
          posts.where({ title: 'Draft' }).updateAll({ views: 1 }),
          posts.deleteAll(),
          posts.connect({ id: 11 }),
          posts.disconnect([{ id: 12 }]),
        ],
        tags: (tags: LooseMutator) => [tags.disconnect([{ id: 'tag-1' }]), tags.deleteAll()],
      } as never,
    });

    expect(updated).toBeNull();
    expect(statementTrace(runtime)).toEqual(['select users']);
  });

  it('executeNestedUpdateMutation() calls each where() callback and each nested create() relation callback once', async () => {
    const whereCallback = vi.fn((post: LoosePostAccessor) => post.views.gt(10));
    const commentsCallback = vi.fn((comments: LooseMutator) =>
      comments.create({ id: 40, body: 'First' }),
    );
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [aliceRow],
      [{ id: 20, title: 'New', user_id: 1, views: 0 }],
      [{ id: 40, body: 'First', post_id: 20 }],
    ]);

    await executeNestedUpdateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        posts: (posts: LooseMutator) => [
          posts.where(whereCallback).updateAll({ views: 1 }),
          posts.where(whereCallback).deleteAll(),
          posts.create({ id: 20, title: 'New', views: 0, comments: commentsCallback }),
        ],
      } as never,
    });

    expect(statementTrace(runtime)).toEqual([
      'select users',
      'update posts',
      'delete posts',
      'insert posts',
      'insert comments',
    ]);
    expect(whereCallback).toHaveBeenCalledTimes(2);
    expect(commentsCallback).toHaveBeenCalledTimes(1);
  });

  it('executeNestedUpdateMutation() calls relation callbacks in nested create() data once on parent-owned and junction relations', async () => {
    const postsCallback = vi.fn((posts: LooseMutator) => posts.connect({ id: 11 }));
    const parentOwned = createMockRuntime();
    parentOwned.setNextResults([
      [{ id: 1, title: 'Post', user_id: 5, views: 10 }],
      [{ id: 7, name: 'Bob', email: 'bob@example.com' }],
      [{ id: 1, title: 'Post', user_id: 7, views: 10 }],
    ]);

    await executeNestedUpdateMutation({
      context: getTestContext(),
      runtime: parentOwned,
      namespaceId: 'public',
      modelName: 'Post',
      filters: [postIdFilter],
      data: {
        author: (author: LooseMutator) =>
          author.create({ id: 7, name: 'Bob', email: 'bob@example.com', posts: postsCallback }),
      } as never,
    });

    expect(postsCallback).toHaveBeenCalledTimes(1);

    const ownerCallback = vi.fn((owner: LooseMutator) => owner.connect({ id: 3 }));
    const whereCallback = vi.fn((child: LooseChildAccessor) => child.id.gt(5));
    const junctionOwned = createMockRuntime();
    junctionOwned.setNextResults([[{ id: 1 }], [{ id: 3 }], [{ id: 20, owner_id: 3 }]]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract: buildManyToManyContractWithTargetRelation() },
      runtime: junctionOwned,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [parentIdFilter],
      data: {
        children: (children: LooseMutator) => [
          children.where(whereCallback).deleteAll(),
          children.create({ id: 20, owner: ownerCallback }),
        ],
      } as never,
    });

    expect(ownerCallback).toHaveBeenCalledTimes(1);
    expect(whereCallback).toHaveBeenCalledTimes(1);
  });

  it('executeNestedCreateMutation() calls relation callbacks in nested create() data once', async () => {
    const commentsCallback = vi.fn((comments: LooseMutator) =>
      comments.create({ id: 40, body: 'First' }),
    );
    const postsCallback = vi.fn((posts: LooseMutator) =>
      posts.create({ id: 20, title: 'New', views: 0, comments: commentsCallback }),
    );
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [aliceRow],
      [{ id: 20, title: 'New', user_id: 1, views: 0 }],
      [{ id: 40, body: 'First', post_id: 20 }],
    ]);

    await executeNestedCreateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: { ...aliceRow, posts: postsCallback } as never,
    });

    expect(statementTrace(runtime)).toEqual(['insert users', 'insert posts', 'insert comments']);
    expect(postsCallback).toHaveBeenCalledTimes(1);
    expect(commentsCallback).toHaveBeenCalledTimes(1);
  });

  const createDataLayouts = [
    {
      layout: 'a one-to-many relation',
      modelName: 'User',
      relationName: 'posts',
      filter: userIdFilter,
      validRow: { id: 20, title: 'New', views: 0 },
      contract: undefined,
    },
    {
      layout: 'a many-to-many relation',
      modelName: 'Parent',
      relationName: 'children',
      filter: parentIdFilter,
      validRow: { id: 20 },
      contract: manyToManyContract(),
    },
    {
      layout: 'a to-one relation the parent owns',
      modelName: 'Post',
      relationName: 'author',
      filter: postIdFilter,
      validRow: { id: 7, name: 'Bob', email: 'bob@example.com' },
      contract: undefined,
    },
  ] as const;

  const invalidCreateRows = [
    { value: 'null', rows: () => [null], expected: { problem: 'missing-data' } },
    { value: 'a string', rows: () => ['row'], expected: { problem: 'invalid-data', index: 0 } },
    {
      value: 'an array',
      rows: () => [[{ id: 20 }]],
      expected: { problem: 'invalid-data', index: 0 },
    },
    {
      value: 'a number after a valid row',
      rows: (validRow: unknown) => [validRow, 7],
      expected: { problem: 'invalid-data', index: 1 },
    },
  ] as const;

  const invalidCreateDataCases = createDataLayouts.flatMap((layout) =>
    invalidCreateRows.map((row) => ({
      name: `${row.value} on ${layout.layout}`,
      layout,
      row,
    })),
  );

  it.each(invalidCreateDataCases)(
    'executeNestedUpdateMutation() rejects nested create() data that is $name before it looks up the row',
    async ({ layout, row }) => {
      const context = layout.contract
        ? { ...getTestContext(), contract: layout.contract }
        : getTestContext();
      const runtime = createMockRuntime();
      runtime.setNextResults([[]]);

      await expect(
        executeNestedUpdateMutation({
          context,
          runtime,
          namespaceId: 'public',
          modelName: layout.modelName,
          filters: [layout.filter],
          data: {
            [layout.relationName]: (mutator: LooseMutator) =>
              mutator.create(row.rows(layout.validRow)),
          } as never,
        }),
      ).rejects.toMatchObject({
        code: 'ORM.RELATION_MUTATION_INVALID',
        meta: { kind: 'create', relation: layout.relationName, ...row.expected },
      });
      expect(runtime.executions).toEqual([]);
    },
  );

  it('executeNestedCreateMutation() rejects nested create() data that is not an object two levels down before any write', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[aliceRow], [{ id: 20, title: 'New', user_id: 1, views: 0 }]]);

    await expect(
      executeNestedCreateMutation({
        context: getTestContext(),
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          ...aliceRow,
          posts: (posts: LooseMutator) =>
            posts.create({
              id: 20,
              title: 'New',
              views: 0,
              comments: (comments: LooseMutator) => comments.create(['body']),
            }),
        } as never,
      }),
    ).rejects.toMatchObject({
      code: 'ORM.RELATION_MUTATION_INVALID',
      meta: { kind: 'create', relation: 'comments', problem: 'invalid-data', index: 0 },
    });
    expect(runtime.executions).toEqual([]);
  });

  it('executeNestedUpdateMutation() inspects each row of a nested create() a bounded number of times', async () => {
    const rowCount = 200;
    const reads = new Array<number>(rowCount).fill(0);
    const rows = Array.from({ length: rowCount }, (_unused, index) => ({
      id: 100 + index,
      title: `Post ${index}`,
      views: 0,
    }));
    const countedRows = new Proxy(rows, {
      get(target, property, receiver) {
        const index = typeof property === 'string' ? Number(property) : Number.NaN;
        if (Number.isInteger(index)) {
          reads[index] = (reads[index] ?? 0) + 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);

    const updated = await executeNestedUpdateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: { posts: () => ({ kind: 'create', data: countedRows }) } as never,
    });

    expect(updated).toBeNull();
    expect(Math.max(...reads)).toBeLessThanOrEqual(4);
  });
});
