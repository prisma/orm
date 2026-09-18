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
  PreparedStatementHandle,
  SqlDriver,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import {
  BinaryExpr,
  ColumnRef,
  collectOrderedParamRefs,
  ProjectionItem,
  RawQueryAst,
  SelectAst as SelectAstCtor,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type {
  AffectedCount,
  Expression,
  ScopeField,
} from '@internal/sql-relational-core/expression';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  SqlMiddleware,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '@internal/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  withTransaction,
} from '@internal/sql-runtime';
import { descriptorsFromCodecs } from '@internal/sql-runtime/test/utils';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../../2-sql/1-core/contract/test/test-support';
import type { SupabaseRoleBinding } from '../src/runtime/supabase-runtime';
import { SupabaseRuntimeImpl } from '../src/runtime/supabase-runtime';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('supabase-runtime-test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('supabase-runtime-test'),
    namespaces: {
      __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

type ExecuteSpy = ReturnType<
  typeof vi.fn<(request: SqlExecuteRequest) => Promise<{ affectedRows: number }>>
>;

interface RecordingTransaction {
  readonly id: symbol;
  readonly executeCalls: Array<{
    sql: string;
    params: readonly unknown[] | undefined;
    handle?: PreparedStatementHandle | undefined;
  }>;
  readonly queryCalls: Array<{
    sql: string;
    params: readonly unknown[] | undefined;
    handle: unknown;
  }>;
  execute: ExecuteSpy;
  query: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
}

interface RecordingConnection {
  readonly id: symbol;
  readonly executeCalls: Array<{
    sql: string;
    params: readonly unknown[] | undefined;
    handle?: PreparedStatementHandle | undefined;
  }>;
  readonly queryCalls: Array<{
    sql: string;
    params: readonly unknown[] | undefined;
    handle: unknown;
  }>;
  readonly beginTransactionSpy: ReturnType<typeof vi.fn>;
  execute: ExecuteSpy;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  beginTransaction(): Promise<RecordingTransaction>;
  readonly transaction: RecordingTransaction;
}

interface RecordingDriver {
  readonly acquireConnectionSpy: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  acquireConnection(): Promise<RecordingConnection>;
  readonly connection: RecordingConnection;
}

function createRecordingDriver(
  queryRows: readonly Record<string, unknown>[] = [{ id: 1 }],
  affectedRows = 0,
): RecordingDriver {
  const txId = Symbol('transaction');
  const connId = Symbol('connection');
  const txExecuteCalls: RecordingConnection['executeCalls'] = [];
  const txQueryCalls: Array<{
    sql: string;
    params: readonly unknown[] | undefined;
    handle: unknown;
  }> = [];
  const connExecuteCalls: RecordingConnection['executeCalls'] = [];
  const connQueryCalls: Array<{
    sql: string;
    params: readonly unknown[] | undefined;
    handle: unknown;
  }> = [];

  const transaction: RecordingTransaction = {
    id: txId,
    get executeCalls() {
      return txExecuteCalls;
    },
    get queryCalls() {
      return txQueryCalls;
    },
    execute: vi
      .fn<(request: SqlExecuteRequest) => Promise<{ affectedRows: number }>>()
      .mockImplementation(async (request) => {
        txExecuteCalls.push({
          sql: request.sql,
          params: request.params,
          handle: request.preparedStatementHandle,
        });
        return { affectedRows };
      }),
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      txQueryCalls.push({
        sql: request.sql,
        params: request.params,
        handle: request.preparedStatementHandle,
      });
      for (const row of queryRows) yield row;
    }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };

  const beginTransactionSpy = vi.fn().mockResolvedValue(transaction);
  const connection: RecordingConnection = {
    id: connId,
    get executeCalls() {
      return connExecuteCalls;
    },
    get queryCalls() {
      return connQueryCalls;
    },
    beginTransactionSpy,
    get transaction() {
      return transaction;
    },
    execute: vi
      .fn<(request: SqlExecuteRequest) => Promise<{ affectedRows: number }>>()
      .mockImplementation(async (request) => {
        connExecuteCalls.push({
          sql: request.sql,
          params: request.params,
          handle: request.preparedStatementHandle,
        });
        return { affectedRows };
      }),
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      connQueryCalls.push({
        sql: request.sql,
        params: request.params,
        handle: request.preparedStatementHandle,
      });
      for (const row of queryRows) yield row;
    }),
    release: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    beginTransaction: () => beginTransactionSpy(),
  };

  const acquireConnectionSpy = vi.fn().mockResolvedValue(connection);
  const driver: RecordingDriver = {
    acquireConnectionSpy,
    get connection() {
      return connection;
    },
    execute: vi.fn().mockResolvedValue({ affectedRows }),
    query: vi.fn().mockImplementation(async function* () {}),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    acquireConnection: () => acquireConnectionSpy(),
  };
  return driver;
}

function createStubAdapter(readMarker?: () => Promise<{ kind: 'absent' }>) {
  const codec: Codec<string> = {
    id: 'pg/int4@1',
    targetTypes: ['int4'],
    encode: (v: number) => v,
    decode: (w: number) => w,
  } as unknown as Codec<string>;
  const codecs = [codec];

  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    __codecs: codecs,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      readMarker: readMarker ?? (async () => ({ kind: 'absent' as const })),
    },
    lower(ast: Parameters<SqlRuntimeAdapterInstance<'postgres'>['lower']>[0]) {
      const params = [...new Set(ast.collectParamRefs())].map((ref) =>
        ref.kind === 'prepared-param-ref'
          ? { kind: 'bind' as const, name: ref.name }
          : { kind: 'literal' as const, value: ref.value },
      );
      return Object.freeze({ sql: JSON.stringify(ast), params });
    },
  };
}

function createTestAdapterDescriptor(
  adapter: ReturnType<typeof createStubAdapter>,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const descriptors = descriptorsFromCodecs(adapter.__codecs);
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
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
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

function createTestSetup(options?: {
  middleware?: readonly SqlMiddleware[];
  affectedRows?: number;
  readMarker?: () => Promise<{ kind: 'absent' }>;
}) {
  const adapter = createStubAdapter(options?.readMarker);
  const driver = createRecordingDriver(undefined, options?.affectedRows);
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

  const runtimeOptions: ConstructorParameters<typeof SupabaseRuntimeImpl>[0] = {
    context,
    adapter: stackInstance.adapter,
    driver: driver as unknown as SqlDriver,
    verifyMarker: options?.readMarker === undefined ? false : 'onFirstUse',
    middleware: options?.middleware ?? [],
  };

  const runtime = new SupabaseRuntimeImpl(runtimeOptions);
  return { runtime, driver };
}

function stubPlan(): SqlExecutionPlan<Record<string, unknown>> {
  return {
    sql: 'select 1',
    params: [],
    ast: SelectAstCtor.from(TableSource.named('stub')),
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
    },
  };
}

function buildEqUserIdPlan(userId: Expression<ScopeField>): SqlQueryPlan<{ id: number }> {
  const users = TableSource.named('users');
  const ast = SelectAstCtor.from(users)
    .withProjection([
      ProjectionItem.of('id', ColumnRef.of('id', 'users'), { codecId: 'pg/int4@1' }),
    ])
    .withWhere(BinaryExpr.eq(ColumnRef.of('id', 'users'), userId.buildAst()));
  return Object.freeze({
    ast,
    params: collectOrderedParamRefs(ast).map((r) => (r.kind === 'param-ref' ? r.value : undefined)),
    meta: {
      target: testContract.target,
      storageHash: testContract.storage.storageHash,
      lane: 'dsl' as const,
    },
  });
}

function buildBumpSeenPlan(userId: Expression<ScopeField>): SqlQueryPlan<AffectedCount> {
  return Object.freeze({
    ast: RawQueryAst.affectedCount([
      'update "users" set seen = now() where id = ',
      userId.buildAst(),
    ]),
    params: [],
    meta: {
      target: testContract.target,
      storageHash: testContract.storage.storageHash,
      lane: 'raw' as const,
    },
  });
}

describe('SupabaseRuntimeImpl', () => {
  describe('openRoleSession — bind-once', () => {
    it('issues exactly two set_config(…,false) calls before any typed query', async () => {
      const { runtime, driver } = createTestSetup();
      const binding: SupabaseRoleBinding = { role: 'authenticated', claims: { sub: 'u1' } };

      const session = await runtime.openRoleSession(binding);
      await session.query(stubPlan()).toArray();
      await session.release();

      const setConfigCalls = driver.connection.executeCalls.filter((c) =>
        c.sql.startsWith('SELECT set_config'),
      );
      expect(setConfigCalls).toEqual([
        { sql: 'SELECT set_config($1, $2, false)', params: ['role', 'authenticated'] },
        {
          sql: 'SELECT set_config($1, $2, false)',
          params: ['request.jwt.claims', JSON.stringify({ sub: 'u1' })],
        },
      ]);
    });

    it('set_config and the typed query land on the same connection', async () => {
      const { runtime, driver } = createTestSetup();
      const sessionControlOnConn: symbol[] = [];
      const queriedOnConn: symbol[] = [];

      driver.connection.execute = vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
        sessionControlOnConn.push(driver.connection.id);
        driver.connection.executeCalls.push({ sql: request.sql, params: request.params });
        return { affectedRows: 0 };
      });
      driver.connection.query = vi.fn().mockImplementation(async function* (
        request: SqlExecuteRequest,
      ) {
        queriedOnConn.push(driver.connection.id);
        driver.connection.queryCalls.push({
          sql: request.sql,
          params: request.params,
          handle: request.preparedStatementHandle,
        });
        yield { id: 1 };
      });

      const session = await runtime.openRoleSession({ role: 'anon' });
      await session.query(stubPlan()).toArray();
      await session.release();

      expect(sessionControlOnConn).toHaveLength(3);
      expect(queriedOnConn).toHaveLength(1);
      expect(sessionControlOnConn[0]).toBe(queriedOnConn[0]);
    });

    it('claims default to {} when not provided', async () => {
      const { runtime, driver } = createTestSetup();

      const session = await runtime.openRoleSession({ role: 'anon' });
      await session.query(stubPlan()).toArray();
      await session.release();

      const claimsCall = driver.connection.executeCalls.find(
        (c) => (c.params as string[])?.[0] === 'request.jwt.claims',
      );
      expect(claimsCall?.params).toEqual(['request.jwt.claims', '{}']);
    });

    it('empty claims serializes as {}', async () => {
      const { runtime, driver } = createTestSetup();

      const session = await runtime.openRoleSession({ role: 'anon', claims: {} });
      await session.query(stubPlan()).toArray();
      await session.release();

      const claimsCall = driver.connection.executeCalls.find(
        (c) => (c.params as string[])?.[0] === 'request.jwt.claims',
      );
      expect(claimsCall?.params).toEqual(['request.jwt.claims', '{}']);
    });
  });

  describe('openRoleSession — below-middleware', () => {
    it('registered middleware sees typed queries, not set_config calls', async () => {
      const observedSqls: string[] = [];
      const observer: SqlMiddleware = {
        name: 'sql-observer',
        familyId: 'sql',
        beforeQuery(exec) {
          observedSqls.push(exec.sql);
        },
      };
      const { runtime } = createTestSetup({ middleware: [observer] });

      const session = await runtime.openRoleSession({ role: 'anon' });
      await session.query(stubPlan()).toArray();
      await session.release();

      // Middleware sees exactly one SQL — the typed query — not the set_config calls
      expect(observedSqls).toHaveLength(1);
      expect(observedSqls[0]).not.toContain('set_config');
    });
  });

  describe('openRoleSession — stickiness', () => {
    it('multiple queries on the same session use the same connection', async () => {
      const { runtime, driver } = createTestSetup();
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      await session.query(stubPlan()).toArray();
      await session.query(stubPlan()).toArray();
      await session.release();

      // acquireConnection called once, not per query
      expect(driver.acquireConnectionSpy).toHaveBeenCalledOnce();
    });

    it('transaction query and execute stay pinned through commit, reset, and release', async () => {
      const { runtime, driver } = createTestSetup({ affectedRows: 3 });
      const cleanupEvents: string[] = [];
      const execute = driver.connection.execute;
      driver.connection.execute = vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
        if (request.sql === 'RESET ALL') cleanupEvents.push('reset');
        return await execute(request);
      });
      driver.connection.transaction.commit = vi.fn().mockImplementation(async () => {
        cleanupEvents.push('commit');
      });
      driver.connection.release = vi.fn().mockImplementation(async () => {
        cleanupEvents.push('release');
      });
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      const tx = await session.transaction();
      await tx.query(stubPlan()).toArray();
      const stats = await tx.execute(stubPlan());
      await tx.commit();
      await session.release();

      expect(stats).toEqual({ affectedRows: 3 });
      expect(driver.connection.beginTransactionSpy).toHaveBeenCalledOnce();
      expect(driver.acquireConnectionSpy).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.query).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.execute).toHaveBeenCalledOnce();
      expect(driver.connection.query).not.toHaveBeenCalled();
      expect(cleanupEvents).toEqual(['commit', 'reset', 'release']);
    });
  });

  describe('openRoleSession — marker verification', () => {
    it('reads the marker before the role session transaction begins', async () => {
      const events: string[] = [];
      const { runtime, driver } = createTestSetup({
        readMarker: async () => {
          events.push('marker');
          return { kind: 'absent' };
        },
      });
      driver.connection.beginTransactionSpy.mockImplementation(async () => {
        events.push('begin');
        return driver.connection.transaction;
      });
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      const tx = await session.transaction();
      await tx.query(stubPlan()).toArray();
      await tx.commit();
      await session.release();

      expect(events).toEqual(['marker', 'begin']);
    });
  });

  describe('openRoleSession — release', () => {
    it('release() sends RESET ALL then releases the connection to the pool', async () => {
      const { runtime, driver } = createTestSetup();
      const resetCalls: string[] = [];

      driver.connection.execute = vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
        driver.connection.executeCalls.push({ sql: request.sql, params: request.params });
        if (request.sql === 'RESET ALL') {
          resetCalls.push(request.sql);
        }
        return { affectedRows: 0 };
      });

      const session = await runtime.openRoleSession({ role: 'anon' });
      await session.release();

      expect(resetCalls).toHaveLength(1);
      expect(driver.connection.release).toHaveBeenCalledOnce();
      expect(driver.connection.destroy).not.toHaveBeenCalled();
    });

    it('when RESET ALL fails, destroys the connection instead of releasing', async () => {
      const { runtime, driver } = createTestSetup();
      const resetError = new Error('RESET ALL failed');

      driver.connection.execute = vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
        driver.connection.executeCalls.push({ sql: request.sql, params: request.params });
        if (request.sql === 'RESET ALL') {
          throw resetError;
        }
        return { affectedRows: 0 };
      });

      const session = await runtime.openRoleSession({ role: 'anon' });
      await session.release();

      expect(driver.connection.destroy).toHaveBeenCalledOnce();
      expect(driver.connection.release).not.toHaveBeenCalled();
    });
  });

  describe('openRoleSession — bind-failure', () => {
    it('destroys the connection and rethrows when set_config fails', async () => {
      const { runtime, driver } = createTestSetup();
      const bindError = new Error('set_config denied');
      let callCount = 0;

      driver.connection.execute = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw bindError;
        }
        return { affectedRows: 0 };
      });

      await expect(runtime.openRoleSession({ role: 'anon' })).rejects.toBe(bindError);
      expect(driver.connection.destroy).toHaveBeenCalledOnce();
      expect(driver.connection.release).not.toHaveBeenCalled();
    });
  });

  describe('queryWithRole — stream cleanup', () => {
    it('resets then releases the session after the stream drains', async () => {
      const { runtime, driver } = createTestSetup();
      const cleanupEvents: string[] = [];
      const execute = driver.connection.execute;
      driver.connection.execute = vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
        if (request.sql === 'RESET ALL') cleanupEvents.push('reset');
        return await execute(request);
      });
      driver.connection.release = vi.fn().mockImplementation(async () => {
        cleanupEvents.push('release');
      });

      const rows = runtime.queryWithRole(stubPlan(), { role: 'anon' });
      expect(driver.acquireConnectionSpy).not.toHaveBeenCalled();

      const iterator = rows[Symbol.asyncIterator]();
      expect(await iterator.next()).toEqual({ value: { id: 1 }, done: false });
      expect(cleanupEvents).toEqual([]);
      expect(await iterator.next()).toEqual({ value: undefined, done: true });

      expect(cleanupEvents).toEqual(['reset', 'release']);
      expect(driver.connection.destroy).not.toHaveBeenCalled();
    });

    it('destroys the session on mid-stream error', async () => {
      const { runtime, driver } = createTestSetup();
      const streamError = new Error('mid-stream failure');

      driver.connection.query = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<unknown>> {
              return Promise.reject(streamError);
            },
          };
        },
      });

      await expect(runtime.queryWithRole(stubPlan(), { role: 'anon' }).toArray()).rejects.toBe(
        streamError,
      );

      expect(driver.connection.destroy).toHaveBeenCalledOnce();
      expect(driver.connection.release).not.toHaveBeenCalled();
    });
  });

  describe('executeWithRole — eager cleanup', () => {
    it('returns connection statistics then resets and releases', async () => {
      const observedSqls: string[] = [];
      const observer: SqlMiddleware = {
        name: 'execute-observer',
        familyId: 'sql',
        beforeExecute(exec) {
          observedSqls.push(exec.sql);
        },
        beforeQuery() {
          throw new Error('query hook ran during execute');
        },
      };
      const { runtime, driver } = createTestSetup({ affectedRows: 4, middleware: [observer] });
      const statementStats = { affectedRows: 4 };
      const cleanupEvents: string[] = [];
      const execute = driver.connection.execute;
      driver.connection.execute = vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
        if (request.sql === 'select 1') return statementStats;
        if (request.sql === 'RESET ALL') cleanupEvents.push('reset');
        return await execute(request);
      });
      driver.connection.release = vi.fn().mockImplementation(async () => {
        cleanupEvents.push('release');
      });

      const stats = await runtime.executeWithRole(stubPlan(), { role: 'service_role' });

      expect(stats).toBe(statementStats);
      expect(cleanupEvents).toEqual(['reset', 'release']);
      expect(observedSqls).toEqual(['select 1']);
      expect(driver.acquireConnectionSpy).toHaveBeenCalledOnce();
      expect(driver.execute).not.toHaveBeenCalled();
      expect(driver.connection.destroy).not.toHaveBeenCalled();
    });

    it('destroys instead of resetting or releasing when execution fails', async () => {
      const { runtime, driver } = createTestSetup();
      const executeError = new Error('execute failed');
      const execute = driver.connection.execute;
      driver.connection.execute = vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
        if (request.sql === 'select 1') throw executeError;
        return await execute(request);
      });

      await expect(runtime.executeWithRole(stubPlan(), { role: 'anon' })).rejects.toBe(
        executeError,
      );

      expect(driver.connection.executeCalls.some((call) => call.sql === 'RESET ALL')).toBe(false);
      expect(driver.connection.destroy).toHaveBeenCalledOnce();
      expect(driver.connection.release).not.toHaveBeenCalled();
    });
  });

  describe('openRoleSession — prepared statements', () => {
    it('statement.query on the session runs on the session connection', async () => {
      const { runtime, driver } = createTestSetup();
      const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
        buildEqUserIdPlan(params.userId),
      );
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      const rows = await ps.query(session, { userId: 1 }).toArray();
      await session.release();

      expect(rows).toEqual([{ id: 1 }]);
      expect(driver.connection.queryCalls).toHaveLength(1);
      expect(driver.connection.queryCalls[0]?.handle).toBeDefined();
      expect(driver.query).not.toHaveBeenCalled();
    });

    it('statement.query on a session transaction runs on that transaction', async () => {
      const { runtime, driver } = createTestSetup();
      const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
        buildEqUserIdPlan(params.userId),
      );
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      const tx = await session.transaction();
      const rows = await ps.query(tx, { userId: 1 }).toArray();
      await tx.commit();
      await session.release();

      expect(rows).toEqual([{ id: 1 }]);
      expect(driver.connection.transaction.queryCalls).toHaveLength(1);
      expect(driver.connection.transaction.queryCalls[0]?.handle).toBeDefined();
      expect(driver.connection.queryCalls).toHaveLength(0);
      expect(driver.query).not.toHaveBeenCalled();
    });
  });

  describe('openRoleSession — prepared statements that report statistics', () => {
    it('statement.execute on the session runs on the session connection', async () => {
      const { runtime, driver } = createTestSetup();
      const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
        buildBumpSeenPlan(params.userId),
      );
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      const stats = await ps.execute(session, { userId: 1 });
      await session.release();

      expect(stats).toEqual({ affectedRows: 0 });
      const preparedCalls = driver.connection.executeCalls.filter((call) => call.handle);
      expect(preparedCalls).toHaveLength(1);
      expect(driver.execute).not.toHaveBeenCalled();
    });

    it('statement.execute on a session transaction runs on that transaction', async () => {
      const { runtime, driver } = createTestSetup();
      const ps = await runtime.prepare({ userId: 'pg/int4@1' as const }, (params) =>
        buildBumpSeenPlan(params.userId),
      );
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      const tx = await session.transaction();
      const stats = await ps.execute(tx, { userId: 1 });
      await tx.commit();
      await session.release();

      expect(stats).toEqual({ affectedRows: 0 });
      expect(driver.connection.transaction.executeCalls).toHaveLength(1);
      expect(driver.connection.transaction.executeCalls[0]?.handle).toBeDefined();
      expect(driver.execute).not.toHaveBeenCalled();
    });
  });

  describe('session transaction — commit and rollback', () => {
    it('commits when the session transaction is committed', async () => {
      const { runtime, driver } = createTestSetup();
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      const tx = await session.transaction();
      await tx.commit();
      await session.release();

      expect(driver.connection.transaction.commit).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.rollback).not.toHaveBeenCalled();
    });

    it('rolls back when the session transaction is rolled back', async () => {
      const { runtime, driver } = createTestSetup();
      const session = await runtime.openRoleSession({ role: 'authenticated' });

      const tx = await session.transaction();
      await tx.rollback();
      await session.release();

      expect(driver.connection.transaction.rollback).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.commit).not.toHaveBeenCalled();
    });

    it('withTransaction over openRoleSession commits on success', async () => {
      const { runtime, driver } = createTestSetup();

      await withTransaction(
        { connection: () => runtime.openRoleSession({ role: 'anon' }) },
        async () => {
          return undefined;
        },
      );

      expect(driver.connection.transaction.commit).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.rollback).not.toHaveBeenCalled();
    });

    it('withTransaction over openRoleSession rolls back on callback throw', async () => {
      const { runtime, driver } = createTestSetup();
      const err = new Error('callback failed');

      await expect(
        withTransaction(
          { connection: () => runtime.openRoleSession({ role: 'anon' }) },
          async () => {
            throw err;
          },
        ),
      ).rejects.toBe(err);

      expect(driver.connection.transaction.rollback).toHaveBeenCalledOnce();
      expect(driver.connection.transaction.commit).not.toHaveBeenCalled();
    });
  });
});
