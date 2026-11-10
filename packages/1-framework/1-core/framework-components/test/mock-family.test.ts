import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import { RuntimeCore } from '../src/execution/runtime-core';
import type { ActivityContextFields, RuntimeMiddleware } from '../src/execution/runtime-middleware';

/**
 * Cross-family demonstration: a fictional "mock" family extends the
 * canonical `RuntimeCore` base and inherits the middleware lifecycle
 * (`activityStarted → runBeforeCompile → lower → beforeEncode → runDriver →
 * onRow → activityEnded → activityFinalized`). Confirms that the abstract
 * base is family-agnostic — i.e. SQL and Mongo are not the only families
 * that can plug in.
 *
 * Originated as a mock-family test for the cross-family middleware SPI
 * project; relocated to framework-components alongside the abstract
 * `RuntimeCore` base in the cross-family runtime unification project.
 */

interface MockContract {
  readonly target: string;
  readonly storageHash: string;
}

interface MockPlan extends QueryPlan {
  readonly draftId: string;
}

interface MockExec extends ExecutionPlan {
  readonly compiledId: string;
}

class MockRuntime extends RuntimeCore<MockPlan, MockExec, RuntimeMiddleware<MockExec>> {
  readonly events: string[] = [];

  constructor(
    middleware: ReadonlyArray<RuntimeMiddleware<MockExec>>,
    ctx: ActivityContextFields,
    private readonly contract: MockContract,
    private readonly rows: ReadonlyArray<Record<string, unknown>>,
  ) {
    super({ middleware, ctx });
  }

  protected lower(plan: MockPlan): MockExec {
    if (plan.meta.target !== this.contract.target) {
      throw new Error(
        `Plan target ${plan.meta.target} does not match contract target ${this.contract.target}`,
      );
    }
    if (plan.meta.storageHash !== this.contract.storageHash) {
      throw new Error(
        `Plan storageHash ${plan.meta.storageHash} does not match contract storageHash ${this.contract.storageHash}`,
      );
    }
    return { compiledId: plan.draftId, meta: plan.meta };
  }

  protected runDriver(_exec: MockExec): AsyncIterable<Record<string, unknown>> {
    const rows = this.rows;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
        for (const row of rows) {
          yield row;
        }
      },
    };
  }

  protected runExecute(): Promise<{ affectedRows: number }> {
    return Promise.resolve({ affectedRows: 0 });
  }

  async close(): Promise<void> {}
}

const ctx: ActivityContextFields = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
  contentHash: async () => 'mock-hash',
  scope: 'runtime',
};

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'test-core',
  lane: 'raw-sql',
};

describe('RuntimeCore with mock family', () => {
  it('executes plans without SQL dependencies', async () => {
    const contract: MockContract = { target: 'mock', storageHash: 'test-core' };
    const runtime = new MockRuntime([], ctx, contract, [{ id: 1, name: 'test' }]);

    const plan: MockPlan = { draftId: 'd-1', meta };

    const results = await runtime.query(plan).toArray();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 1, name: 'test' });
  });

  it('rejects plans whose `lower` raises (cross-family pre-execution validation)', async () => {
    const contract: MockContract = { target: 'mock', storageHash: 'test-core' };
    const runtime = new MockRuntime([], ctx, contract, []);

    const invalidPlan: MockPlan = {
      draftId: 'd-2',
      meta: {
        target: 'other',
        storageHash: 'other-core',
        lane: 'raw-sql',
      },
    };

    await expect(runtime.query(invalidPlan).toArray()).rejects.toThrow(
      'Plan target other does not match contract target mock',
    );
  });

  it('drives middleware hooks for any family', async () => {
    const hooks: string[] = [];

    const middleware: RuntimeMiddleware<MockExec> = {
      name: 'test-middleware',
      async activityStarted() {
        hooks.push('activityStarted');
      },
      async beforeEncode() {
        hooks.push('beforeEncode');
      },
      async onRow() {
        hooks.push('onRow');
      },
      async activityEnded() {
        hooks.push('activityEnded');
      },
      async activityFinalized() {
        hooks.push('activityFinalized');
      },
    };

    const contract: MockContract = { target: 'mock', storageHash: 'test-core' };
    const runtime = new MockRuntime([middleware], ctx, contract, [{ id: 1 }]);

    await runtime.query({ draftId: 'd-3', meta }).toArray();

    expect(hooks).toEqual([
      'activityStarted',
      'beforeEncode',
      'onRow',
      'activityEnded',
      'activityFinalized',
    ]);
  });
});
