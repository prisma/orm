import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type {
  MarkerReadResult,
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlQueryable,
  SqlTransaction,
} from '@internal/sql-relational-core/ast';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { type Mock, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { createSqlExecutionStack } from '../src/sql-context';
import type { Runtime } from '../src/sql-runtime';
import {
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContext,
  createTestContract,
  createTestRuntime,
  createTestStackInstance,
  createTestTargetDescriptor,
  type StubAdapter,
} from './utils';

export const contract = createTestContract({ storageHash: 'runtime-closed' });

export const closedError = {
  code: 'DRIVER.NOT_CONNECTED',
  message: 'Runtime is closed',
};

export function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export function delay(ms: number): Promise<void> {
  return new Promise((settle) => setTimeout(settle, ms));
}

// close() starts refusing on a timer it schedules; a timer scheduled after close() fires after it.
export function afterRefusalBegins(): Promise<void> {
  return delay(0);
}

// Resolves to the settled outcome of `operation`, or 'pending' if it has not settled within `ms`.
export function outcomeWithin(operation: Promise<unknown>, ms = 50): Promise<unknown> {
  return Promise.race([
    operation.then(
      (value) => ({ resolved: value }),
      (error: unknown) => error,
    ),
    delay(ms).then(() => 'pending'),
  ]);
}

// Each hook runs inside the matching driver call before it records its work; tests replace them to delay or fail that call.
export interface StubDriverHooks {
  acquire: () => Promise<void>;
  execute: () => Promise<void>;
  firstRow: () => Promise<void>;
  commit: () => Promise<void>;
  close: () => Promise<void>;
}

export interface ClosedRuntimeFixture {
  readonly runtime: Runtime;
  readonly driver: SqlDriver;
  readonly connection: SqlConnection;
  readonly transaction: SqlTransaction;
  readonly calls: string[];
  readonly hooks: StubDriverHooks;
}

function createStubDriver(): Omit<ClosedRuntimeFixture, 'runtime'> {
  const calls: string[] = [];
  let heldConnections = 0;
  const releaseWaiters: Array<() => void> = [];
  const hooks: StubDriverHooks = {
    acquire: async () => {},
    execute: async () => {},
    firstRow: async () => {},
    commit: async () => {},
    close: () => delay(0),
  };

  const releaseHeld = async (): Promise<void> => {
    heldConnections -= 1;
    for (const wake of releaseWaiters.splice(0)) wake();
  };

  function queryable(name: string) {
    return {
      query: vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
        calls.push(`${name}.query`);
        await hooks.firstRow();
        for (const id of [1, 2, 3]) {
          yield { id };
        }
      }),
      execute: vi.fn().mockImplementation(async (_request: SqlExecuteRequest) => {
        await hooks.execute();
        calls.push(`${name}.execute`);
        return { affectedRows: 1 };
      }),
    };
  }

  const transaction = {
    ...queryable('transaction'),
    commit: vi.fn().mockImplementation(async () => {
      await hooks.commit();
      calls.push('commit');
    }),
    rollback: vi.fn().mockImplementation(async () => {
      calls.push('rollback');
    }),
  };

  const connection = {
    ...queryable('connection'),
    release: vi.fn().mockImplementation(async () => {
      calls.push('release');
      await releaseHeld();
    }),
    destroy: vi.fn().mockImplementation(async () => {
      calls.push('destroy');
      await releaseHeld();
    }),
    beginTransaction: vi.fn().mockResolvedValue(transaction),
  };

  const driver: SqlDriver = {
    ...queryable('driver'),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockImplementation(async () => {
      await hooks.acquire();
      heldConnections += 1;
      calls.push('acquire');
      return connection;
    }),
    close: vi.fn().mockImplementation(async () => {
      calls.push('close');
      while (heldConnections > 0) {
        await new Promise<void>((wake) => releaseWaiters.push(wake));
      }
      await hooks.close();
      calls.push('closed');
    }),
  };

  return { driver, calls, connection, transaction, hooks };
}

export function createMiddlewareSpy(): {
  readonly middleware: SqlMiddleware;
  readonly beforeQuery: Mock;
  readonly beforeExecute: Mock;
} {
  const beforeQuery = vi.fn(async () => {
    throw new Error('beforeQuery ran');
  });
  const beforeExecute = vi.fn(async () => {
    throw new Error('beforeExecute ran');
  });
  const middleware: SqlMiddleware = {
    name: 'closed-runtime-spy',
    familyId: 'sql',
    beforeQuery,
    beforeExecute,
  };
  return { middleware, beforeQuery, beforeExecute };
}

export function setup(
  options: {
    readonly middleware?: readonly SqlMiddleware[];
    readonly closeRefusal?: 'when-idle' | 'at-once';
  } = {},
): ClosedRuntimeFixture {
  const stub = createStubDriver();
  const runtime = createTestRuntime({
    stackInstance: createTestStackInstance(),
    context: createTestContext(contract, createStubAdapter()),
    driver: stub.driver,
    verifyMarker: false,
    ...(options.middleware !== undefined ? { middleware: options.middleware } : {}),
    ...(options.closeRefusal !== undefined ? { closeRefusal: options.closeRefusal } : {}),
  });
  return { runtime, ...stub };
}

export function setupWithMarkerReader(
  readMarker: (queryable: SqlQueryable) => Promise<MarkerReadResult>,
): ClosedRuntimeFixture {
  const stub = createStubDriver();
  const base = createStubAdapter();
  const adapter: StubAdapter = { ...base, profile: { ...base.profile, readMarker } };
  const stack = createSqlExecutionStack({
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(adapter),
    extensions: [],
  });
  const runtime = createTestRuntime({
    stackInstance: instantiateExecutionStack(stack),
    context: createTestContext(contract, adapter),
    driver: stub.driver,
  });
  return { runtime, ...stub };
}

export function rowsPlan(): SqlQueryPlan<{ id: unknown }> {
  return planFromAst(
    RawQueryAst.rows(['select id from "user"'], { id: { codecId: 'pg/int4@1', nullable: false } }),
    contract,
  );
}

export function affectedCountPlan(): SqlQueryPlan<AffectedCount> {
  return planFromAst(RawQueryAst.affectedCount(['update "user" set seen = now()']), contract);
}
