import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@internal/framework-components/execution';
import { SqlStorage } from '@internal/sql-contract/types';
import type {
  Codec,
  SelectAst,
  SqlDriver,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import type { Runtime } from '../src/sql-runtime';
import { defineTestCodec } from './test-codec';
import { createTestRuntime as createRuntime, descriptorsFromCodecs, stubAst } from './utils';

/**
 * Verifies the SQL runtime populates `RuntimeMiddlewareContext.scope`
 * differently for the three queryable surfaces: top-level `runtime.query`,
 * `connection.query` (after `runtime.connection()`), and
 * `transaction.query` (after `connection.transaction()` or
 * `withTransaction`).
 *
 * The cache middleware (TML-2143 M3) reads `ctx.scope` to bypass caching on
 * connection / transaction scopes; this test pins the contract so a
 * regression in scope plumbing surfaces here rather than via a confusing
 * cache-coherence bug.
 */

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('test'),
    namespaces: {
      __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

function createCodecs(): ReadonlyArray<Codec<string>> {
  return [
    defineTestCodec({
      typeId: 'pg/int4@1',
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  ];
}

function createStubAdapter() {
  const codecs = createCodecs();
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return codecs;
      },
      readMarker: async () => ({ kind: 'absent' as const }),
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

function createMockDriver(): SqlDriver {
  const transaction = {
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
      yield { id: 3 } as Record<string, unknown>;
    }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
  const connection = {
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
      yield { id: 2 } as Record<string, unknown>;
    }),
    release: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    beginTransaction: vi.fn().mockResolvedValue(transaction),
  };
  return {
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
      yield { id: 1 } as Record<string, unknown>;
    }),
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockResolvedValue(connection),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createTestAdapterDescriptor(
  adapter: ReturnType<typeof createStubAdapter>,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const descriptors = descriptorsFromCodecs(adapter.profile.codecs());
  return {
    kind: 'adapter',
    rawCodecInferer: { inferCodec: () => 'pg/text' },
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as unknown as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

function createTestSetup(middleware: readonly SqlMiddleware[]) {
  const adapter = createStubAdapter();
  const driver = createMockDriver();

  const targetDescriptor = createTestTargetDescriptor();
  const adapterDescriptor = createTestAdapterDescriptor(adapter);

  const stack = createSqlExecutionStack({
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensions: [],
  });
  type SqlTestStackInstance = ExecutionStackInstance<
    'sql',
    'postgres',
    SqlRuntimeAdapterInstance<'postgres'>,
    RuntimeDriverInstance<'sql', 'postgres'>,
    RuntimeExtensionInstance<'sql', 'postgres'>
  >;
  const stackInstance = instantiateExecutionStack(stack) as unknown as SqlTestStackInstance;

  const context = createExecutionContext({
    contract: testContract,
    stack: { target: targetDescriptor, adapter: adapterDescriptor, extensions: [] },
  });

  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    verifyMarker: false,
    middleware,
  });

  return { runtime };
}

function createRawExecutionPlan(): SqlExecutionPlan {
  return {
    sql: 'select 1',
    params: [],
    ast: stubAst(),
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
    },
  };
}

describe('SQL runtime scope plumbing', () => {
  it('populates ctx.scope = "runtime" on top-level runtime.query', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeQuery(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    await runtime.query(createRawExecutionPlan()).toArray();

    expect(seen).toEqual(['runtime']);
  });

  it('populates ctx.scope = "connection" on connection.query', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeQuery(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const connection = await runtime.connection();
    try {
      await connection.query(createRawExecutionPlan()).toArray();
    } finally {
      await connection.release();
    }

    expect(seen).toEqual(['connection']);
  });

  it('populates ctx.scope = "transaction" on transaction.query', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeQuery(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const connection = await runtime.connection();
    const transaction = await connection.transaction();
    try {
      await transaction.query(createRawExecutionPlan()).toArray();
      await transaction.commit();
    } finally {
      await connection.release();
    }

    expect(seen).toEqual(['transaction']);
  });

  it('populates ctx.scope = "runtime" on top-level statement.query(runtime, ...)', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeQuery(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const ps = await runtime.prepare({}, () => ({
      ast: stubAst(),
      params: [],
      meta: {
        target: testContract.target,
        targetFamily: testContract.targetFamily,
        storageHash: testContract.storage.storageHash,
        lane: 'raw',
      },
    }));

    await ps.query(runtime, {}).toArray();
    expect(seen).toEqual(['runtime']);
  });

  it('populates ctx.scope = "connection" on statement.query(connection, ...)', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeQuery(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const ps = await runtime.prepare({}, () => ({
      ast: stubAst(),
      params: [],
      meta: {
        target: testContract.target,
        targetFamily: testContract.targetFamily,
        storageHash: testContract.storage.storageHash,
        lane: 'raw',
      },
    }));

    const connection = await runtime.connection();
    try {
      await ps.query(connection, {}).toArray();
    } finally {
      await connection.release();
    }

    expect(seen).toEqual(['connection']);
  });

  it('populates ctx.scope = "transaction" on statement.query(transaction, ...)', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeQuery(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const ps = await runtime.prepare({}, () => ({
      ast: stubAst(),
      params: [],
      meta: {
        target: testContract.target,
        targetFamily: testContract.targetFamily,
        storageHash: testContract.storage.storageHash,
        lane: 'raw',
      },
    }));

    const connection = await runtime.connection();
    const transaction = await connection.transaction();
    try {
      await ps.query(transaction, {}).toArray();
      await transaction.commit();
    } finally {
      await connection.release();
    }

    expect(seen).toEqual(['transaction']);
  });

  it('routes a sequence of queries to the right scope each time', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeQuery(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);

    // Top-level.
    await runtime.query(createRawExecutionPlan()).toArray();

    // Connection-scoped.
    const connection = await runtime.connection();
    await connection.query(createRawExecutionPlan()).toArray();

    // Transaction-scoped.
    const transaction = await connection.transaction();
    await transaction.query(createRawExecutionPlan()).toArray();
    await transaction.commit();
    await connection.release();

    // And another top-level after returning the connection to the pool.
    await runtime.query(createRawExecutionPlan()).toArray();

    expect(seen).toEqual(['runtime', 'connection', 'transaction', 'runtime']);
  });

  // The execute twin of the three statement.query scope cases above: the cache
  // middleware reads ctx.scope, and a wrong scope string is otherwise silent.
  const prepareAffectedCount = async (runtime: Runtime) =>
    runtime.prepare({}, () =>
      planFromAst<AffectedCount>(
        RawQueryAst.affectedCount(['update "user" set seen = now()']),
        testContract,
      ),
    );

  it('populates ctx.scope = "runtime" on top-level statement.execute(runtime, ...)', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeExecute(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const ps = await prepareAffectedCount(runtime);

    await ps.execute(runtime, {});

    expect(seen).toEqual(['runtime']);
  });

  it('populates ctx.scope = "connection" on statement.execute(connection, ...)', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeExecute(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const ps = await prepareAffectedCount(runtime);

    const connection = await runtime.connection();
    try {
      await ps.execute(connection, {});
    } finally {
      await connection.release();
    }

    expect(seen).toEqual(['connection']);
  });

  it('populates ctx.scope = "transaction" on statement.execute(transaction, ...)', async () => {
    const seen: Array<'runtime' | 'connection' | 'transaction'> = [];
    const observer: SqlMiddleware = {
      name: 'scope-observer',
      familyId: 'sql',
      async beforeExecute(_plan, ctx) {
        seen.push(ctx.scope);
      },
    };

    const { runtime } = createTestSetup([observer]);
    const ps = await prepareAffectedCount(runtime);

    const connection = await runtime.connection();
    const transaction = await connection.transaction();
    try {
      await ps.execute(transaction, {});
      await transaction.commit();
    } finally {
      await connection.release();
    }

    expect(seen).toEqual(['transaction']);
  });
});
