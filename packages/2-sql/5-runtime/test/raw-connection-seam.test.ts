import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@internal/framework-components/execution';
import type { RuntimeExecuteOptions } from '@internal/framework-components/runtime';
import { SqlStorage } from '@internal/sql-contract/types';
import type {
  Codec,
  MarkerReadResult,
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlQueryable,
} from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
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
import type { RuntimeOptions } from '../src/sql-runtime';
import { SqlRuntimeBase } from '../src/sql-runtime';
import { defineTestCodec } from './test-codec';
import { descriptorsFromCodecs, stubAst } from './utils';

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('queryable-seam-test'),
  domain: applicationDomainOf({ models: {} }),
  roots: {},
  storage: new SqlStorage({
    storageHash: coreHash('queryable-seam-test'),
    namespaces: {
      __unbound__: createTestSqlNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
  extensions: {},
  capabilities: {},
  meta: {},
};

function createStubAdapter() {
  const codecs: ReadonlyArray<Codec<string>> = [
    defineTestCodec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  ];

  return {
    __codecs: codecs,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      readMarker: async (_queryable: SqlQueryable): Promise<MarkerReadResult> => ({
        kind: 'absent',
      }),
    },
    lower(ast: Parameters<SqlRuntimeAdapterInstance<'postgres'>['lower']>[0]) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] as const });
    },
  };
}

interface RecordingConnection {
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  readonly beginTransaction: ReturnType<typeof vi.fn>;
  readonly queryCalls: Array<{ sql: string; params: readonly unknown[] | undefined }>;
}

function createRecordingDriver(): {
  driver: SqlDriver;
  connection: RecordingConnection;
  acquireConnectionSpy: ReturnType<typeof vi.fn>;
} {
  const queryCalls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
  const connection: RecordingConnection = {
    get queryCalls() {
      return queryCalls;
    },
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      queryCalls.push({ sql: request.sql, params: request.params });
      yield { id: 42 };
    }),
    release: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
  };

  const acquireConnectionSpy = vi.fn().mockResolvedValue(connection);

  const driver: SqlDriver = {
    execute: vi.fn().mockResolvedValue({ affectedRows: 0 }),
    query: vi.fn().mockImplementation(async function* () {}),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: () => acquireConnectionSpy(),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { driver, connection, acquireConnectionSpy };
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
  return {
    kind: 'adapter',
    rawCodecInferer: { inferCodec: () => 'pg/text' },
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptorsFromCodecs(adapter.__codecs),
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

/**
 * Test-local concrete subclass exposing the protected seams under public names.
 */
class TestRuntime extends SqlRuntimeBase {
  acquireRawConn(): Promise<SqlConnection> {
    return this.acquireRawConnection();
  }

  runQueryAgainstQueryable<Row>(
    plan: Parameters<SqlRuntimeBase['queryAgainstQueryable']>[0],
    queryable: Parameters<SqlRuntimeBase['queryAgainstQueryable']>[1],
    options?: RuntimeExecuteOptions,
  ) {
    return this.queryAgainstQueryable<Row>(plan, queryable, options);
  }
}

function createTestSetup(options?: {
  middleware?: readonly SqlMiddleware[];
  readMarker?: (queryable: SqlQueryable) => Promise<MarkerReadResult>;
}) {
  const base = createStubAdapter();
  const adapter =
    options?.readMarker === undefined
      ? base
      : { ...base, profile: { ...base.profile, readMarker: options.readMarker } };
  const { driver, connection, acquireConnectionSpy } = createRecordingDriver();

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

  const runtimeOptions: RuntimeOptions = {
    context,
    adapter: stackInstance.adapter,
    driver: driver as unknown as SqlDriver,
    verifyMarker: options?.readMarker === undefined ? false : 'onFirstUse',
    middleware: options?.middleware ?? [],
    closeRefusal: undefined,
  };

  const runtime = new TestRuntime(runtimeOptions);

  return { runtime, driver, connection, acquireConnectionSpy };
}

function rawPlan<Row = Record<string, unknown>>(
  overrides?: Partial<SqlExecutionPlan<Row>>,
): SqlExecutionPlan<Row> {
  return {
    sql: 'select 1',
    params: [],
    ast: stubAst(),
    ...overrides,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
      ...overrides?.meta,
    },
  };
}

describe('acquireRawConnection', () => {
  it('returns the driver connection (identity)', async () => {
    const { runtime, connection } = createTestSetup();
    const raw = await runtime.acquireRawConn();
    expect(raw).toBe(connection);
  });

  it('SQL issued via the raw connection bypasses middleware', async () => {
    const observedSqls: string[] = [];
    const observer: SqlMiddleware = {
      name: 'observer',
      familyId: 'sql',
      beforeQuery(exec) {
        observedSqls.push(exec.sql);
      },
    };

    const { runtime, connection } = createTestSetup({ middleware: [observer] });
    const raw = await runtime.acquireRawConn();

    for await (const row of raw.query({ sql: 'SET LOCAL role = $1', params: ['viewer'] })) {
      void row;
    }

    expect(connection.queryCalls).toEqual([{ sql: 'SET LOCAL role = $1', params: ['viewer'] }]);
    expect(observedSqls).toHaveLength(0);
  });
});

describe('queryAgainstQueryable', () => {
  it('runs a typed plan through middleware against the supplied queryable', async () => {
    const observedSqls: string[] = [];
    const observer: SqlMiddleware = {
      name: 'observer',
      familyId: 'sql',
      beforeQuery(exec) {
        observedSqls.push(exec.sql);
      },
    };

    const { runtime, connection } = createTestSetup({ middleware: [observer] });
    const raw = await runtime.acquireRawConn();

    const plan = rawPlan({ sql: 'select id from users' });
    await runtime.runQueryAgainstQueryable(plan, raw).toArray();

    expect(observedSqls).toEqual(['select id from users']);
    expect(connection.query).toHaveBeenCalledOnce();
  });

  it('reads the contract marker through the driver, not the raw connection a subclass supplies', async () => {
    const readMarker = vi.fn<(queryable: SqlQueryable) => Promise<MarkerReadResult>>(async () => ({
      kind: 'absent',
    }));
    const { runtime, driver, connection } = createTestSetup({ readMarker });
    const raw = await runtime.acquireRawConn();

    await runtime.runQueryAgainstQueryable(rawPlan(), raw).toArray();

    expect(readMarker).toHaveBeenCalledOnce();
    expect(readMarker).toHaveBeenCalledWith(driver);
    expect(readMarker).not.toHaveBeenCalledWith(connection);
  });

  it('sticks to the connection supplied — not the driver root', async () => {
    const { runtime, driver, connection } = createTestSetup();
    const raw = await runtime.acquireRawConn();

    await runtime.runQueryAgainstQueryable(rawPlan(), raw).toArray();

    expect(connection.query).toHaveBeenCalledOnce();
    expect(driver.query).not.toHaveBeenCalled();
  });
});
