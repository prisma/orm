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
import { SelectAst as SelectAstCtor, TableSource } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import type {
  SqlMiddleware,
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { descriptorsFromCodecs } from '@internal/sql-runtime/test/utils';
import { applicationDomainOf } from '@repo/test-utils';
import { vi } from 'vitest';
import { createTestSqlNamespace } from '../../../2-sql/1-core/contract/test/test-support';
import { SupabaseRuntimeImpl } from '../src/runtime/supabase-runtime';

export const testContract: Contract<SqlStorage> = {
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

export interface RecordingTransaction {
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

export interface RecordingConnection {
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

export interface RecordingDriver {
  readonly acquireConnectionSpy: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  acquireConnection(): Promise<RecordingConnection>;
  readonly connection: RecordingConnection;
}

export function createRecordingDriver(
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

function createStubAdapter() {
  const codec: Codec<string> = {
    id: 'pg/int4@1',
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
      readMarker: async () => ({ kind: 'absent' as const }),
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

export function createTestSetup(options?: {
  middleware?: readonly SqlMiddleware[];
  affectedRows?: number;
}) {
  const adapter = createStubAdapter();
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
    verifyMarker: false,
    middleware: options?.middleware ?? [],
    closeRefusal: undefined,
  };

  const runtime = new SupabaseRuntimeImpl(runtimeOptions);
  return { runtime, driver };
}

export function stubPlan(): SqlExecutionPlan<Record<string, unknown>> {
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
