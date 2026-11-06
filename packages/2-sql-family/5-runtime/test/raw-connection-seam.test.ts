import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@internal/framework-components/execution';
import type { ActivityParent, RuntimeExecuteOptions } from '@internal/framework-components/runtime';
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
import type { CloseRefusal, RuntimeOptions, RuntimeTransaction } from '../src/sql-runtime';
import { SqlRuntimeBase } from '../src/sql-runtime';
import { createTransactionStart, transactionStart } from '../src/transaction-state';
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
      toWire: (v: number) => v,
      fromWire: (w: number) => w,
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
  acquireRawConn(activityParent?: ActivityParent): Promise<SqlConnection> {
    return this.acquireRawConnection({ activityParent });
  }

  beginOn(connection: SqlConnection): Promise<RuntimeTransaction> {
    return this.beginTransactionOn(
      connection,
      { [transactionStart]: createTransactionStart() },
      undefined,
    );
  }

  runQueryAgainstQueryable<Row>(
    plan: Parameters<SqlRuntimeBase['queryAgainstQueryable']>[0],
    queryable: Parameters<SqlRuntimeBase['queryAgainstQueryable']>[1],
    options?: RuntimeExecuteOptions,
  ) {
    return this.queryAgainstQueryable<Row>(plan, queryable, options);
  }
}

const closedError = { code: 'DRIVER.NOT_CONNECTED', message: 'Runtime is closed' };

function activityParent(state: { readonly open: boolean }): ActivityParent {
  return { acceptsChildren: () => state.open } as unknown as ActivityParent;
}

function settlesWithin(operation: Promise<void>, ms = 50): Promise<'settled' | 'pending'> {
  return Promise.race([
    operation.then(() => 'settled' as const),
    new Promise<'pending'>((settle) => setTimeout(() => settle('pending'), ms)),
  ]);
}

function afterIdleTurns(): Promise<void> {
  return new Promise((settle) => setTimeout(settle, 5));
}

function createTestSetup(options?: {
  middleware?: readonly SqlMiddleware[];
  readMarker?: (queryable: SqlQueryable) => Promise<MarkerReadResult>;
  closeRefusal?: CloseRefusal;
  ownsDriver?: boolean;
  log?: RuntimeOptions['log'];
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
    closeRefusal: options?.closeRefusal,
    ownsDriver: options?.ownsDriver,
    ...(options?.log === undefined ? {} : { log: options.log }),
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
  it('releases and destroys the driver connection', async () => {
    const { runtime, connection } = createTestSetup();
    const released = await runtime.acquireRawConn();
    await released.release();
    const destroyed = await runtime.acquireRawConn();
    const reason = new Error('broken');
    await destroyed.destroy(reason);

    expect({
      release: connection.release.mock.calls,
      destroy: connection.destroy.mock.calls,
    }).toEqual({ release: [[]], destroy: [[reason]] });
  });

  it('is refused once close() has started', async () => {
    const { runtime, acquireConnectionSpy } = createTestSetup();
    await runtime.close();

    await expect(runtime.acquireRawConn()).rejects.toMatchObject(closedError);
    expect(acquireConnectionSpy).not.toHaveBeenCalled();
  });

  it('does not keep close() waiting while it is held between statements', async () => {
    const { runtime, driver } = createTestSetup();
    await runtime.acquireRawConn();

    await runtime.close();

    expect(driver.close).toHaveBeenCalledOnce();
  });

  it('is admitted after close() has started beneath an activity that is still open', async () => {
    const { runtime, acquireConnectionSpy } = createTestSetup({ closeRefusal: 'at-once' });
    void runtime.close();

    await runtime.acquireRawConn(activityParent({ open: true }));

    expect(acquireConnectionSpy).toHaveBeenCalledOnce();
  });

  it('is refused after close() has started beneath an activity that has ended', async () => {
    const { runtime, acquireConnectionSpy } = createTestSetup({ closeRefusal: 'at-once' });
    void runtime.close();

    await expect(runtime.acquireRawConn(activityParent({ open: false }))).rejects.toMatchObject(
      closedError,
    );
    expect(acquireConnectionSpy).not.toHaveBeenCalled();
  });

  it.each(['commit', 'rollback'] as const)(
    'keeps close() waiting for a transaction on it until the %s',
    async (end) => {
      const { runtime, driver, connection } = createTestSetup();
      connection.beginTransaction.mockResolvedValue({
        query: connection.query,
        execute: connection.execute,
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
      });
      const raw = await runtime.acquireRawConn();
      const transaction = await runtime.beginOn(raw);

      let closed = false;
      const closing = runtime.close().then(() => {
        closed = true;
      });
      await afterIdleTurns();
      const closedWhileOpen = closed;
      await transaction[end]();
      await closing;

      expect({ closedWhileOpen, driverClosed: vi.mocked(driver.close).mock.calls.length }).toEqual({
        closedWhileOpen: false,
        driverClosed: 1,
      });
    },
  );

  it('lets close() finish when acquiring the connection fails', async () => {
    const { runtime, driver, acquireConnectionSpy } = createTestSetup();
    acquireConnectionSpy.mockRejectedValueOnce(new Error('pool exhausted'));

    await expect(runtime.acquireRawConn()).rejects.toThrow('pool exhausted');
    await runtime.close();

    expect(driver.close).toHaveBeenCalledOnce();
  });

  it('SQL issued via the raw connection bypasses middleware', async () => {
    const observedSqls: string[] = [];
    const observer: SqlMiddleware = {
      name: 'observer',
      familyId: 'sql',
      beforeEncode(exec) {
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

describe('a statement sent directly on a raw connection', () => {
  function gate() {
    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { opened, open };
  }

  it('keeps close() waiting while an execute is pending', async () => {
    const { runtime, driver, connection } = createTestSetup();
    const statement = gate();
    connection.execute.mockImplementationOnce(async () => {
      await statement.opened;
      return { affectedRows: 0 };
    });
    const raw = await runtime.acquireRawConn();
    const pending = raw.execute({ sql: 'SELECT 1' });

    const closing = runtime.close();
    await afterIdleTurns();
    const closedWhilePending = vi.mocked(driver.close).mock.calls.length;
    statement.open();
    await pending;
    await closing;

    expect({ closedWhilePending, closed: vi.mocked(driver.close).mock.calls.length }).toEqual({
      closedWhilePending: 0,
      closed: 1,
    });
  });

  it('keeps close() waiting while a query stream waits for its first row', async () => {
    const { runtime, driver, connection } = createTestSetup();
    const firstRow = gate();
    connection.query.mockImplementationOnce(async function* () {
      await firstRow.opened;
      yield { id: 1 };
    });
    const raw = await runtime.acquireRawConn();
    const rows = raw.query({ sql: 'SELECT id' })[Symbol.asyncIterator]();
    const reading = rows.next();

    const closing = runtime.close();
    await afterIdleTurns();
    const closedWhileReading = vi.mocked(driver.close).mock.calls.length;
    firstRow.open();
    await reading;
    await closing;

    expect({ closedWhileReading, closed: vi.mocked(driver.close).mock.calls.length }).toEqual({
      closedWhileReading: 0,
      closed: 1,
    });
  });

  it('does not keep close() waiting for a query stream read in part and dropped', async () => {
    const { runtime, driver } = createTestSetup();
    const raw = await runtime.acquireRawConn();
    await raw.query({ sql: 'SELECT id' })[Symbol.asyncIterator]().next();

    await expect(settlesWithin(runtime.close())).resolves.toBe('settled');
    expect(driver.close).toHaveBeenCalledOnce();
  });

  it('does not keep close() waiting for a query stream never read', async () => {
    const { runtime, driver } = createTestSetup();
    const raw = await runtime.acquireRawConn();
    raw.query({ sql: 'SELECT id' });

    await expect(settlesWithin(runtime.close())).resolves.toBe('settled');
    expect(driver.close).toHaveBeenCalledOnce();
  });

  it('lets close() finish after a statement fails', async () => {
    const { runtime, driver, connection } = createTestSetup();
    connection.execute.mockRejectedValueOnce(new Error('statement failed'));
    const raw = await runtime.acquireRawConn();
    await expect(raw.execute({ sql: 'SELECT 1' })).rejects.toThrow('statement failed');

    await expect(settlesWithin(runtime.close())).resolves.toBe('settled');
    expect(driver.close).toHaveBeenCalledOnce();
  });
});

describe('a transaction that never settles', () => {
  function stubTransaction(connection: ReturnType<typeof createTestSetup>['connection']) {
    const transaction = {
      query: connection.query,
      execute: connection.execute,
      commit: vi.fn().mockRejectedValue(new Error('commit failed')),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    connection.beginTransaction.mockResolvedValue(transaction);
    return transaction;
  }

  it('does not keep close() waiting after its commit failed and nothing rolled it back', async () => {
    const { runtime, driver, connection } = createTestSetup();
    stubTransaction(connection);
    const raw = await runtime.acquireRawConn();
    const transaction = await runtime.beginOn(raw);
    await expect(transaction.commit()).rejects.toThrow('commit failed');
    await raw.release();

    await expect(settlesWithin(runtime.close())).resolves.toBe('settled');
    expect(driver.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['released', 'release'],
    ['destroyed', 'destroy'],
  ] as const)('does not keep close() waiting once its connection is %s', async (_name, dispose) => {
    const { runtime, driver, connection } = createTestSetup();
    stubTransaction(connection);
    const raw = await runtime.acquireRawConn();
    await runtime.beginOn(raw);
    await raw[dispose]();

    await expect(settlesWithin(runtime.close())).resolves.toBe('settled');
    expect(driver.close).toHaveBeenCalledOnce();
  });

  it('is named in the warning close() logs while it waits only for it', async () => {
    const warn = vi.fn();
    const { runtime, connection } = createTestSetup({
      log: { info: vi.fn(), warn, error: vi.fn() },
    });
    stubTransaction(connection).commit.mockResolvedValue(undefined);
    const transaction = await runtime.beginOn(await runtime.acquireRawConn());

    const closing = runtime.close();
    await afterIdleTurns();
    await transaction.commit();
    await closing;

    expect(warn.mock.calls).toEqual([
      [{ event: 'runtime.close.waiting-for-activities', openActivities: 0, openTransactions: 1 }],
    ]);
  });
});

describe('a runtime that does not own its driver', () => {
  it('waits for a transaction whose start hooks are still running when close() is called', async () => {
    let startHooks: () => void = () => undefined;
    const hooksDone = new Promise<void>((resolve) => {
      startHooks = resolve;
    });
    const slowStart: SqlMiddleware = {
      name: 'slow-start',
      familyId: 'sql',
      async activityStarted(activity) {
        if (activity.kind === 'transaction') await hooksDone;
      },
    };
    const { runtime, connection } = createTestSetup({
      middleware: [slowStart],
      closeRefusal: 'at-once',
      ownsDriver: false,
    });
    connection.beginTransaction.mockResolvedValue({
      query: connection.query,
      execute: connection.execute,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    });
    const beginning = runtime.beginOn(await runtime.acquireRawConn());

    const closing = runtime.close();
    const whileStarting = await settlesWithin(closing);
    startHooks();
    const transaction = await beginning;
    const whileOpen = await settlesWithin(closing);
    await transaction.commit();
    await closing;

    expect({ whileStarting, whileOpen }).toEqual({
      whileStarting: 'pending',
      whileOpen: 'pending',
    });
  });

  it('lets close() finish when a transaction start hook fails', async () => {
    const failingStart: SqlMiddleware = {
      name: 'failing-start',
      familyId: 'sql',
      async activityStarted(activity) {
        if (activity.kind === 'transaction') throw new Error('start refused');
      },
    };
    const { runtime } = createTestSetup({ middleware: [failingStart], ownsDriver: false });
    await expect(runtime.beginOn(await runtime.acquireRawConn())).rejects.toThrow('start refused');

    await expect(settlesWithin(runtime.close())).resolves.toBe('settled');
  });

  it('closes while an ordinary connection or a raw one is held idle, and refuses new connections', async () => {
    const { runtime, driver } = createTestSetup({ ownsDriver: false });
    await runtime.connection();
    await runtime.acquireRawConn();

    await runtime.close();

    await expect(runtime.connection()).rejects.toMatchObject(closedError);
    expect(driver.close).not.toHaveBeenCalled();
  });

  it('refuses new work and waits for work in flight on close(), and leaves the driver open', async () => {
    const { runtime, driver, connection } = createTestSetup({ ownsDriver: false });
    connection.beginTransaction.mockResolvedValue({
      query: connection.query,
      execute: connection.execute,
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    });
    const transaction = await runtime.beginOn(await runtime.acquireRawConn());

    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    await afterIdleTurns();
    const closedWhileOpen = closed;
    await transaction.commit();
    await closing;

    await expect(runtime.execute(rawPlan())).rejects.toMatchObject(closedError);
    await expect(runtime.acquireRawConn()).rejects.toMatchObject(closedError);
    expect({ closedWhileOpen, driverClosed: vi.mocked(driver.close).mock.calls.length }).toEqual({
      closedWhileOpen: false,
      driverClosed: 0,
    });
  });
});

describe('queryAgainstQueryable', () => {
  it('runs a typed plan through middleware against the supplied queryable', async () => {
    const observedSqls: string[] = [];
    const observer: SqlMiddleware = {
      name: 'observer',
      familyId: 'sql',
      beforeEncode(exec) {
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
