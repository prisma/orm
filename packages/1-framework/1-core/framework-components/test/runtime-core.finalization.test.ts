import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import { RuntimeCore } from '../src/execution/runtime-core';
import type { ActivityContext, RuntimeMiddleware } from '../src/execution/runtime-middleware';
import { contextFields } from './statement-fixtures';

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
  readonly activityId: string;
  readonly ctx: ActivityContext;
}

class MockRuntime extends RuntimeCore<MockPlan, MockExec, RuntimeMiddleware<MockExec>> {
  constructor(
    middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>,
    private readonly failure: Error | undefined,
  ) {
    super({ middleware, ctx: contextFields() });
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

function recorder(events: HookEvent[], label = 'recorder'): RuntimeMiddleware<MockExec> {
  return {
    name: label,
    async activityEnded(activity, result, ctx) {
      events.push({ name: `${label}:ended:${result.outcome}`, activityId: activity.id, ctx });
    },
    async activityFinalized(activity, result, ctx) {
      events.push({ name: `${label}:finalized:${result.outcome}`, activityId: activity.id, ctx });
    },
  };
}

const plan: MockPlan = { draftId: 'd-1', meta };
const names = (events: readonly HookEvent[]) => events.map((event) => event.name);

describe('RuntimeCore statement finalization', () => {
  it('finalizes a query committed right after it ends, with the activity and context it ended with', async () => {
    const events: HookEvent[] = [];
    const runtime = new MockRuntime([recorder(events)], undefined);

    await runtime.query(plan).toArray();

    const [ended, finalized] = events;
    expect(names(events)).toEqual(['recorder:ended:succeeded', 'recorder:finalized:committed']);
    expect(finalized?.activityId).toBe(ended?.activityId);
    expect(finalized?.ctx).toBe(ended?.ctx);
  });

  it('finalizes a query unknown when the driver throws', async () => {
    const events: HookEvent[] = [];
    const runtime = new MockRuntime([recorder(events)], new Error('driver failed'));

    await expect(runtime.query(plan).toArray()).rejects.toThrow('driver failed');

    expect(names(events)).toEqual(['recorder:ended:failed', 'recorder:finalized:unknown']);
  });

  it('ends a query stopped and finalizes it unknown when the caller stops reading', async () => {
    const events: HookEvent[] = [];
    const runtime = new MockRuntime([recorder(events)], undefined);

    for await (const _row of runtime.query(plan)) {
      break;
    }

    expect(names(events)).toEqual(['recorder:ended:stopped', 'recorder:finalized:unknown']);
  });

  it('finalizes an execute committed after it ends', async () => {
    const events: HookEvent[] = [];
    const runtime = new MockRuntime([recorder(events)], undefined);

    await runtime.execute(plan);

    expect(names(events)).toEqual(['recorder:ended:succeeded', 'recorder:finalized:committed']);
  });

  it('finalizes an execute unknown when the driver throws', async () => {
    const events: HookEvent[] = [];
    const runtime = new MockRuntime([recorder(events)], new Error('driver failed'));

    await expect(runtime.execute(plan)).rejects.toThrow('driver failed');

    expect(names(events)).toEqual(['recorder:ended:failed', 'recorder:finalized:unknown']);
  });

  it("ignores middleware added to the caller's array after creation", async () => {
    const events: HookEvent[] = [];
    const middleware: RuntimeMiddleware<MockExec>[] = [recorder(events)];
    const runtime = new MockRuntime(middleware, undefined);
    middleware.push(recorder(events, 'late'));

    await runtime.query(plan).toArray();

    expect(names(events)).toEqual(['recorder:ended:succeeded', 'recorder:finalized:committed']);
  });
});
