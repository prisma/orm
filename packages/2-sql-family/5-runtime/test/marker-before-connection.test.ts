import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type {
  MarkerReadResult,
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlQueryable,
} from '@internal/sql-relational-core/ast';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { createSqlExecutionStack } from '../src/sql-context';
import { SqlRuntimeBase, withTransaction } from '../src/sql-runtime';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContext,
  createTestContract,
  createTestTargetDescriptor,
  type StubAdapter,
} from './utils';

const contract = createTestContract({ storageHash: 'marker-before-connection' });

class RawConnectionRuntime extends SqlRuntimeBase {
  rawConnection(): Promise<SqlConnection> {
    return this.acquireRawConnection();
  }
}

type ReadMarker = (queryable: SqlQueryable) => Promise<MarkerReadResult>;

function setup(options: { readMarker?: ReadMarker; verifyMarker?: false } = {}) {
  const calls: string[] = [];
  const readMarker = vi.fn<ReadMarker>(
    options.readMarker ??
      (async () => {
        calls.push('marker');
        return { kind: 'absent' };
      }),
  );

  function queryable(name: string) {
    return {
      query: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
        calls.push(`${name}.query`);
        yield { id: 1 };
      }),
      execute: vi.fn().mockImplementation(async (_request: SqlExecuteRequest) => {
        calls.push(`${name}.execute`);
        return { affectedRows: 1 };
      }),
    };
  }

  const transaction = {
    ...queryable('transaction'),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    savepoint: vi.fn().mockRejectedValue(new Error('savepoint is not stubbed')),
  };
  const connection = {
    ...queryable('connection'),
    release: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    beginTransaction: vi.fn().mockResolvedValue(transaction),
  };
  const acquireConnection = vi.fn().mockImplementation(async () => {
    calls.push('acquire');
    return connection;
  });
  const driver: SqlDriver = {
    ...queryable('driver'),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection,
    close: vi.fn().mockResolvedValue(undefined),
  };

  const base = createStubAdapter();
  const adapter: StubAdapter = { ...base, profile: { ...base.profile, readMarker } };
  const stack = createSqlExecutionStack({
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(adapter),
    extensions: [],
  });
  const runtime = new RawConnectionRuntime({
    context: createTestContext(contract, adapter),
    adapter: instantiateExecutionStack(stack).adapter,
    driver,
    ...(options.verifyMarker === false ? { verifyMarker: false } : {}),
  });
  return { runtime, driver, readMarker, acquireConnection, connection, calls };
}

function affectedCountPlan(): SqlQueryPlan<AffectedCount> {
  return planFromAst(RawQueryAst.affectedCount(['update "user" set seen = now()']), contract);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function afterPendingWork(): Promise<void> {
  return new Promise((settle) => setTimeout(settle, 5));
}

describe('the contract marker check before a connection is taken', () => {
  it('reads the marker through the driver before connection() acquires one', async () => {
    const { runtime, driver, readMarker, calls } = setup();

    const connection = await runtime.connection();
    await connection.execute(affectedCountPlan());
    await connection.release();

    expect(readMarker.mock.calls).toEqual([[driver]]);
    expect(calls).toEqual(['marker', 'acquire', 'connection.execute']);
  });

  it('reads the marker through the driver before a transaction acquires its connection', async () => {
    const { runtime, driver, readMarker, calls } = setup();

    await withTransaction(runtime, (tx) => tx.execute(affectedCountPlan()));

    expect(readMarker.mock.calls).toEqual([[driver]]);
    expect(calls).toEqual(['marker', 'acquire', 'transaction.execute']);
  });

  it("reads the marker through the driver before a subclass's raw connection is acquired", async () => {
    const { runtime, driver, readMarker, calls } = setup();

    const raw = await runtime.rawConnection();
    await raw.execute({ sql: 'select 1' });

    expect(readMarker.mock.calls).toEqual([[driver]]);
    expect(calls).toEqual(['marker', 'acquire', 'connection.execute']);
  });

  it('acquires no connection while the marker read is still running', async () => {
    const markerRead = deferred<MarkerReadResult>();
    const { runtime, acquireConnection } = setup({ readMarker: () => markerRead.promise });

    const opening = runtime.connection();
    await afterPendingWork();
    expect(acquireConnection).not.toHaveBeenCalled();

    markerRead.resolve({ kind: 'absent' });
    await (await opening).release();
    expect(acquireConnection).toHaveBeenCalledOnce();
  });

  it('shares one marker read among concurrent first calls of every kind', async () => {
    const markerRead = deferred<MarkerReadResult>();
    const { runtime, readMarker, acquireConnection } = setup({
      readMarker: () => markerRead.promise,
    });

    const first = Promise.all([
      runtime.connection().then((connection) => connection.release()),
      withTransaction(runtime, (tx) => tx.execute(affectedCountPlan())),
      runtime.rawConnection().then((raw) => raw.release()),
      runtime.execute(affectedCountPlan()),
    ]);
    await afterPendingWork();
    markerRead.resolve({ kind: 'absent' });
    await first;
    await (await runtime.connection()).release();

    expect(readMarker).toHaveBeenCalledOnce();
    expect(acquireConnection).toHaveBeenCalledTimes(4);
  });

  it('reads nothing when verifyMarker is false', async () => {
    const { runtime, readMarker } = setup({ verifyMarker: false });

    await (await runtime.connection()).release();
    await withTransaction(runtime, (tx) => tx.execute(affectedCountPlan()));
    await (await runtime.rawConnection()).release();
    await runtime.execute(affectedCountPlan());

    expect(readMarker).not.toHaveBeenCalled();
  });

  describe('when the marker read fails', () => {
    const failure = new Error('simulated marker read failure');

    it.each([
      ['connection()', (runtime: RawConnectionRuntime) => runtime.connection()],
      [
        'a transaction',
        (runtime: RawConnectionRuntime) =>
          withTransaction(runtime, (tx) => tx.execute(affectedCountPlan())),
      ],
      ["a subclass's raw connection", (runtime: RawConnectionRuntime) => runtime.rawConnection()],
    ])('rejects %s, takes no connection, and the next call retries the read', async (_, open) => {
      const readMarker = vi
        .fn<ReadMarker>()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({ kind: 'absent' });
      const { runtime, acquireConnection } = setup({ readMarker });

      await expect(open(runtime)).rejects.toBe(failure);
      expect(acquireConnection).not.toHaveBeenCalled();

      await (await runtime.connection()).release();
      expect(readMarker).toHaveBeenCalledTimes(2);
      expect(acquireConnection).toHaveBeenCalledOnce();
    });
  });
});
