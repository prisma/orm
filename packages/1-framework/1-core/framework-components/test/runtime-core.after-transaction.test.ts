import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import { RuntimeCore } from '../src/execution/runtime-core';
import type {
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '../src/execution/runtime-middleware';

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'test',
  lane: 'raw-sql',
};

interface MockPlan extends QueryPlan {
  readonly draftId: string;
}

interface MockExec extends ExecutionPlan {
  readonly compiledId: string;
}

interface HookEvent {
  readonly name: string;
  readonly exec: MockExec;
  readonly planExecutionId: string;
}

class MockRuntime extends RuntimeCore<MockPlan, MockExec, RuntimeMiddleware<MockExec>> {
  constructor(
    middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>,
    private readonly failure: Error | undefined,
  ) {
    super({ middleware, ctx });
  }

  protected lower(plan: MockPlan): MockExec {
    return { compiledId: plan.draftId, meta: plan.meta };
  }

  protected async *runDriver(): AsyncIterable<Record<string, unknown>> {
    yield { id: 1 };
    if (this.failure) throw this.failure;
    yield { id: 2 };
  }

  protected async runExecute(): Promise<{ affectedRows: number }> {
    if (this.failure) throw this.failure;
    return { affectedRows: 1 };
  }

  async close(): Promise<void> {}
}

const ctx: RuntimeMiddlewareContext = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
  contentHash: async () => 'mock-hash',
  scope: 'runtime',
  planExecutionId: '',
};

function recorder(events: HookEvent[]): RuntimeMiddleware<MockExec> & {
  afterTransaction: NonNullable<RuntimeMiddleware<MockExec>['afterTransaction']>;
} {
  const record = (name: string, exec: MockExec, hookCtx: RuntimeMiddlewareContext) => {
    events.push({ name, exec, planExecutionId: hookCtx.planExecutionId });
  };
  return {
    name: 'recorder',
    async afterQuery(exec, _result, hookCtx) {
      record('afterQuery', exec, hookCtx);
    },
    async afterExecute(exec, _result, hookCtx) {
      record('afterExecute', exec, hookCtx);
    },
    async afterTransaction(exec, result, hookCtx) {
      record(`afterTransaction:${result.outcome}`, exec, hookCtx);
    },
  };
}

function createSetup(failure?: Error) {
  const events: HookEvent[] = [];
  const runtime = new MockRuntime([recorder(events)], failure);
  return { events, runtime };
}

const plan: MockPlan = { draftId: 'd-1', meta };
const names = (events: readonly HookEvent[]) => events.map((event) => event.name);

describe('RuntimeCore afterTransaction stage', () => {
  it('fires committed after afterQuery with the plan and context the after-hook saw', async () => {
    const { runtime, events } = createSetup();

    await runtime.query(plan).toArray();

    const [afterQuery, afterTransaction] = events;
    expect(names(events)).toEqual(['afterQuery', 'afterTransaction:committed']);
    expect(afterTransaction?.exec).toBe(afterQuery?.exec);
    expect(afterTransaction?.planExecutionId).toBe(afterQuery?.planExecutionId);
  });

  it('fires unknown after afterQuery when the driver throws', async () => {
    const { runtime, events } = createSetup(new Error('driver failed'));

    await expect(runtime.query(plan).toArray()).rejects.toThrow('driver failed');

    expect(names(events)).toEqual(['afterQuery', 'afterTransaction:unknown']);
  });

  it('fires unknown once when the caller stops reading the rows', async () => {
    const { runtime, events } = createSetup();

    for await (const _row of runtime.query(plan)) {
      break;
    }

    expect(names(events)).toEqual(['afterTransaction:unknown']);
  });

  it('fires committed after afterExecute', async () => {
    const { runtime, events } = createSetup();

    await runtime.execute(plan);

    expect(names(events)).toEqual(['afterExecute', 'afterTransaction:committed']);
  });

  it('fires unknown after afterExecute when the driver throws', async () => {
    const { runtime, events } = createSetup(new Error('driver failed'));

    await expect(runtime.execute(plan)).rejects.toThrow('driver failed');

    expect(names(events)).toEqual(['afterExecute', 'afterTransaction:unknown']);
  });

  it('fires nothing when no middleware declared afterTransaction at creation', async () => {
    const events: HookEvent[] = [];
    const { afterTransaction, ...withoutAfterTransaction } = recorder(events);
    const middleware: RuntimeMiddleware<MockExec> = withoutAfterTransaction;
    const runtime = new MockRuntime([middleware], undefined);
    middleware.afterTransaction = afterTransaction;

    await runtime.query(plan).toArray();
    await runtime.execute(plan);

    expect(names(events)).toEqual(['afterQuery', 'afterExecute']);
  });
});
