import type { PlanMeta } from '@internal/contract/types';
import type { ActivityParent } from '../src/execution/activity-lifecycle';
import type { ExecutionPlan } from '../src/execution/query-plan';
import { executeStatement, streamStatement } from '../src/execution/run-with-middleware';
import type {
  ActivityContextFields,
  ParamRefMutator,
  RuntimeMiddleware,
  RuntimeStatementStats,
} from '../src/execution/runtime-middleware';

export const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'test',
  lane: 'raw-sql',
};

export interface MockExec extends ExecutionPlan {
  readonly id: string;
}

export const exec: MockExec = { id: 'exec-1', meta };

export function contextFields(overrides?: Partial<ActivityContextFields>): ActivityContextFields {
  return {
    contract: {},
    mode: 'strict',
    now: () => Date.now(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    contentHash: async () => 'mock-hash',
    scope: 'runtime',
    ...overrides,
  };
}

export async function* yieldRows<R>(rows: ReadonlyArray<R>): AsyncGenerator<R, void, unknown> {
  for (const row of rows) {
    yield row;
  }
}

export async function collect<Row>(iterable: AsyncIterable<Row>): Promise<Row[]> {
  const read: Row[] = [];
  for await (const row of iterable) read.push(row);
  return read;
}

export interface StatementSetup {
  readonly context?: ActivityContextFields;
  readonly parent?: ActivityParent;
  readonly params?: ParamRefMutator;
  readonly plan?: MockExec;
}

export function queryStatement<Row = Record<string, unknown>>(
  middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>,
  runDriver: () => AsyncIterable<Row>,
  setup: StatementSetup = {},
): AsyncIterable<Row> {
  return streamStatement(
    {
      middleware,
      plan: exec,
      context: setup.context ?? contextFields(),
      parent: setup.parent,
    },
    async function* (run) {
      await run.beforeEncode(exec, setup.params);
      yield* run.runQuery(exec, runDriver);
    },
  );
}

export function executeStatementWith(
  middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>,
  runDriver: () => Promise<RuntimeStatementStats>,
  setup: StatementSetup = {},
): Promise<RuntimeStatementStats> {
  return executeStatement(
    {
      middleware,
      plan: setup.plan ?? exec,
      context: setup.context ?? contextFields(),
      parent: setup.parent,
    },
    async (run) => {
      await run.beforeEncode(exec, setup.params);
      return run.runExecute(exec, runDriver);
    },
  );
}

/** Middleware that records every hook it receives as `label:hook[:detail]`. */
export function recorder(label: string, events: string[]): RuntimeMiddleware<MockExec> {
  return {
    name: label,
    async activityStarted(activity) {
      events.push(`${label}:started:${activity.kind}`);
    },
    async beforeEncode() {
      events.push(`${label}:beforeEncode`);
    },
    intercept: {
      async onQuery() {
        events.push(`${label}:onQuery`);
        return undefined;
      },
      async onExecute() {
        events.push(`${label}:onExecute`);
        return undefined;
      },
    },
    async onRow() {
      events.push(`${label}:onRow`);
    },
    async activityEnded(activity, result) {
      events.push(`${label}:ended:${activity.kind}:${result.outcome}`);
    },
    async activityFinalized(activity, result) {
      events.push(`${label}:finalized:${activity.kind}:${result.outcome}`);
    },
  };
}
