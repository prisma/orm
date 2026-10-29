import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type {
  Activity,
  ActivityFinalizedResult,
  RuntimeMode,
} from '@internal/framework-components/runtime';
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
import { ifDefined } from '@internal/utils/defined';
import { vi } from 'vitest';
import type { SqlMiddleware, SqlMiddlewareContext } from '../src/middleware/sql-middleware';
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

export const doublingCodec = defineTestCodec({
  typeId: 'test/doubling@1',
  toWire: (value: number) => value * 2,
  fromWire: (wire: number) => wire / 2,
});

const failingDecodeCodec = defineTestCodec({
  typeId: 'test/failing-decode@1',
  toWire: (value: number) => value,
  fromWire: (): number => {
    throw new Error('decode failed');
  },
});

export interface HookEvent {
  readonly name: string;
  readonly sql?: string;
  readonly activity?: Activity;
  readonly ctx?: SqlMiddlewareContext;
}

export interface DriverFailures {
  readonly begin?: Error;
  readonly query?: Error;
  readonly execute?: Error;
  readonly commit?: Error;
  readonly rollback?: Error;
  readonly commitHeldUntil?: Promise<void>;
  readonly rollbackHeldUntil?: Promise<void>;
  readonly release?: Error;
  readonly destroy?: Error;
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
    beginTransaction: vi.fn().mockImplementation(async () => {
      events.push({ name: 'begin' });
      if (failures.begin) throw failures.begin;
      return transaction;
    }),
    release: vi.fn().mockImplementation(settle('release', failures.release)),
    destroy: vi.fn().mockImplementation(settle('destroy', failures.destroy)),
  };
  return {
    ...queryable,
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockResolvedValue(connection),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function sqlOf(activity: Activity): string | undefined {
  if (activity.kind !== 'statement') return undefined;
  const { plan } = activity;
  return 'sql' in plan && typeof plan.sql === 'string' ? plan.sql : undefined;
}

function recorder(
  events: HookEvent[],
  activityFinalized: SqlMiddleware['activityFinalized'] | undefined,
  beforeHookFailure: Error | undefined,
): SqlMiddleware {
  const record = (name: string, activity: Activity, ctx: SqlMiddlewareContext) => {
    events.push({ name, ...ifDefined('sql', sqlOf(activity)), activity, ctx });
  };
  return {
    name: 'recorder',
    familyId: 'sql',
    async activityStarted(activity, ctx) {
      record(`started:${activity.kind}`, activity, ctx);
    },
    async beforeEncode(plan, ctx) {
      events.push({ name: 'beforeEncode', sql: plan.sql, ctx });
      if (beforeHookFailure) throw beforeHookFailure;
    },
    async activityEnded(activity, result, ctx) {
      record(`ended:${activity.kind}:${result.outcome}`, activity, ctx);
    },
    async activityFinalized(activity, result, ctx) {
      record(`finalized:${activity.kind}:${result.outcome}`, activity, ctx);
      await activityFinalized?.(activity, result, ctx);
    },
  };
}

export interface SetupOptions {
  readonly failures?: DriverFailures;
  readonly activityFinalized?: SqlMiddleware['activityFinalized'];
  readonly beforeHookFailure?: Error;
  readonly readMarker?: () => Promise<MarkerReadResult>;
  readonly log?: Log;
  readonly mode?: RuntimeMode;
  /** Middleware registered after the recorder. */
  readonly middleware?: readonly SqlMiddleware[];
  /** When false, the recorder implements no `activityFinalized`. */
  readonly recordFinalized?: boolean;
  readonly closeRefusal?: 'when-idle' | 'at-once';
}

export function createSetup(options: SetupOptions = {}) {
  const events: HookEvent[] = [];
  const { activityFinalized: recordFinalized, ...recorderWithoutFinalized } = recorder(
    events,
    options.activityFinalized,
    options.beforeHookFailure,
  );
  const middleware: SqlMiddleware =
    options.recordFinalized === false || recordFinalized === undefined
      ? recorderWithoutFinalized
      : { ...recorderWithoutFinalized, activityFinalized: recordFinalized };
  const stubAdapter = createStubAdapter();
  const { readMarker } = options;
  const adapter = {
    ...stubAdapter,
    __codecs: [...stubAdapter.__codecs, failingDecodeCodec, doublingCodec],
    profile:
      readMarker === undefined ? stubAdapter.profile : { ...stubAdapter.profile, readMarker },
  };
  const stack = createSqlExecutionStack({
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(adapter),
    extensions: [],
  });
  const driver = createDriver(events, options.failures ?? {});
  const runtime = createRuntime({
    stackInstance: instantiateExecutionStack(stack),
    context: createTestContext(testContract, adapter),
    driver,
    verifyMarker: readMarker === undefined ? false : 'onFirstUse',
    middleware: [middleware, ...(options.middleware ?? [])],
    ...(options.log ? { log: options.log } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.closeRefusal ? { closeRefusal: options.closeRefusal } : {}),
  });
  return { runtime, events, middleware, driver };
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

/** Every lifecycle event and driver call, without the starts, beforeEncode and BEGIN. */
export const afterHookNames = (events: readonly HookEvent[]) =>
  names(events).filter(
    (name) => !name.startsWith('started:') && name !== 'beforeEncode' && name !== 'begin',
  );

/** The statements' finalization outcomes, in order. */
export const stages = (events: readonly HookEvent[]) =>
  names(events).filter((name) => name.startsWith('finalized:statement'));

export const transactionStages = (events: readonly HookEvent[]) =>
  names(events).filter((name) => name.startsWith('finalized:transaction'));

export type Outcome = ActivityFinalizedResult['outcome'];

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
