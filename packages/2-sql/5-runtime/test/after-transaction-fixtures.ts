import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { AfterTransactionResult } from '@internal/framework-components/runtime';
import {
  type MarkerReadResult,
  RawQueryAst,
  type SqlDriver,
} from '@internal/sql-relational-core/ast';
import {
  planFromAst,
  type SqlExecutionPlan,
  type SqlQueryPlan,
} from '@internal/sql-relational-core/plan';
import { vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { createSqlExecutionStack } from '../src/sql-context';
import type { Log } from '../src/sql-runtime';
import { defineTestCodec } from './test-codec';
import {
  createTestRuntime as createRuntime,
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContext,
  createTestContract,
  createTestTargetDescriptor,
  stubAst,
} from './utils';

export const testContract = createTestContract({ targetFamily: 'sql', target: 'postgres' });

const failingDecodeCodec = defineTestCodec({
  typeId: 'test/failing-decode@1',
  toWire: (value: number) => value,
  fromWire: (): number => {
    throw new Error('decode failed');
  },
});

export interface HookEvent {
  readonly name: string;
  readonly plan?: SqlExecutionPlan;
  readonly planExecutionId?: string;
}

export interface DriverFailures {
  readonly query?: Error;
  readonly execute?: Error;
  readonly commit?: Error;
  readonly rollback?: Error;
  readonly commitHeldUntil?: Promise<void>;
  readonly rollbackHeldUntil?: Promise<void>;
}

function createDriver(events: HookEvent[], failures: DriverFailures): SqlDriver {
  const queryable = {
    query: vi.fn().mockImplementation(async function* () {
      yield { id: 1 };
      if (failures.query) throw failures.query;
      yield { id: 2 };
    }),
    execute: vi.fn().mockImplementation(async () => {
      if (failures.execute) throw failures.execute;
      return { affectedRows: 1 };
    }),
  };
  const settle =
    (name: string, failure: Error | undefined, heldUntil?: Promise<void>) => async () => {
      await heldUntil;
      events.push({ name });
      if (failure) throw failure;
    };
  const transaction = {
    ...queryable,
    commit: vi.fn().mockImplementation(settle('commit', failures.commit, failures.commitHeldUntil)),
    rollback: vi
      .fn()
      .mockImplementation(settle('rollback', failures.rollback, failures.rollbackHeldUntil)),
  };
  const connection = {
    ...queryable,
    beginTransaction: vi.fn().mockResolvedValue(transaction),
    release: vi.fn().mockImplementation(settle('release', undefined)),
    destroy: vi.fn().mockImplementation(settle('destroy', undefined)),
  };
  return {
    ...queryable,
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockResolvedValue(connection),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function recorder(
  events: HookEvent[],
  afterTransaction: SqlMiddleware['afterTransaction'] | undefined,
  beforeHookFailure: Error | undefined,
): Required<Pick<SqlMiddleware, 'afterQuery' | 'afterExecute' | 'afterTransaction'>> &
  SqlMiddleware {
  const record = (name: string, plan: SqlExecutionPlan, planExecutionId: string) => {
    events.push({ name, plan, planExecutionId });
  };
  return {
    name: 'recorder',
    familyId: 'sql',
    async beforeQuery(plan, ctx) {
      record('beforeQuery', plan, ctx.planExecutionId);
      if (beforeHookFailure) throw beforeHookFailure;
    },
    async beforeExecute(plan, ctx) {
      record('beforeExecute', plan, ctx.planExecutionId);
      if (beforeHookFailure) throw beforeHookFailure;
    },
    async afterQuery(plan, _result, ctx) {
      record('afterQuery', plan, ctx.planExecutionId);
    },
    async afterExecute(plan, _result, ctx) {
      record('afterExecute', plan, ctx.planExecutionId);
    },
    async afterTransaction(plan, result, ctx) {
      record(`afterTransaction:${result.outcome}`, plan, ctx.planExecutionId);
      await afterTransaction?.(plan, result, ctx);
    },
  };
}

export interface SetupOptions {
  readonly failures?: DriverFailures;
  readonly afterTransaction?: SqlMiddleware['afterTransaction'];
  readonly beforeHookFailure?: Error;
  readonly readMarker?: () => Promise<MarkerReadResult>;
  readonly log?: Log;
  readonly declaresAfterTransaction?: boolean;
}

export function createSetup(options: SetupOptions = {}) {
  const events: HookEvent[] = [];
  const { afterTransaction, ...withoutAfterTransaction } = recorder(
    events,
    options.afterTransaction,
    options.beforeHookFailure,
  );
  const middleware: SqlMiddleware =
    options.declaresAfterTransaction === false
      ? withoutAfterTransaction
      : { ...withoutAfterTransaction, afterTransaction };
  const stubAdapter = createStubAdapter();
  const { readMarker } = options;
  const adapter = {
    ...stubAdapter,
    __codecs: [...stubAdapter.__codecs, failingDecodeCodec],
    profile:
      readMarker === undefined ? stubAdapter.profile : { ...stubAdapter.profile, readMarker },
  };
  const stack = createSqlExecutionStack({
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(adapter),
    extensions: [],
  });
  const runtime = createRuntime({
    stackInstance: instantiateExecutionStack(stack),
    context: createTestContext(testContract, adapter),
    driver: createDriver(events, options.failures ?? {}),
    verifyMarker: readMarker === undefined ? false : 'onFirstUse',
    middleware: [middleware],
    ...(options.log ? { log: options.log } : {}),
  });
  return { runtime, events, middleware, afterTransaction };
}

export type Setup = ReturnType<typeof createSetup>;

export const meta = {
  target: testContract.target,
  targetFamily: testContract.targetFamily,
  storageHash: testContract.storage.storageHash,
  lane: 'raw' as const,
};

export function rawPlan(sql: string): SqlExecutionPlan {
  return { sql, params: [], ast: stubAst(), meta };
}

export function failingDecodePlan(): SqlQueryPlan<{ id: number }> {
  return planFromAst(
    RawQueryAst.rows(['select id from t'], {
      id: { codecId: failingDecodeCodec.id, nullable: false },
    }),
    testContract,
  );
}

export const names = (events: readonly HookEvent[]) => events.map((event) => event.name);

export const afterHookNames = (events: readonly HookEvent[]) =>
  names(events).filter((name) => !name.startsWith('before'));

export const stages = (events: readonly HookEvent[]) =>
  names(events).filter((name) => name.startsWith('afterTransaction'));

export type Outcome = AfterTransactionResult['outcome'];

export interface TransactionCase {
  readonly title: string;
  readonly failures: DriverFailures;
  readonly callbackFails: boolean;
  readonly outcome: Outcome;
  readonly error: string | undefined;
}

export const transactionCases: ReadonlyArray<TransactionCase> = [
  {
    title: 'commit resolves',
    failures: {},
    callbackFails: false,
    outcome: 'committed',
    error: undefined,
  },
  {
    title: 'the callback throws and rollback resolves',
    failures: {},
    callbackFails: true,
    outcome: 'rolled-back',
    error: 'callback failed',
  },
  {
    title: 'the callback throws and rollback rejects',
    failures: { rollback: new Error('rollback failed') },
    callbackFails: true,
    outcome: 'rolled-back',
    error: 'Transaction rollback failed after callback error',
  },
  {
    title: 'commit rejects and the cleanup rollback resolves',
    failures: { commit: new Error('commit failed') },
    callbackFails: false,
    outcome: 'unknown',
    error: 'Transaction commit failed',
  },
  {
    title: 'commit rejects and the cleanup rollback rejects',
    failures: { commit: new Error('commit failed'), rollback: new Error('rollback failed') },
    callbackFails: false,
    outcome: 'unknown',
    error: 'Transaction commit failed',
  },
];
