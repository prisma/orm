import type { PlanMeta } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import { RuntimeCore } from '../src/execution/runtime-core';
import type { RuntimeExecutor, RuntimeMiddleware } from '../src/execution/runtime-middleware';

interface FixturePlan extends QueryPlan {
  readonly draftId: string;
}
interface FixtureExec extends ExecutionPlan {
  readonly compiledId: string;
}

class FixtureRuntime extends RuntimeCore<FixturePlan, FixtureExec, RuntimeMiddleware<FixtureExec>> {
  protected lower(plan: FixturePlan): FixtureExec {
    return { compiledId: plan.draftId, meta: plan.meta };
  }
  protected runDriver(): AsyncIterable<Record<string, unknown>> {
    return {
      async *[Symbol.asyncIterator]() {},
    };
  }
  protected runExecute(): Promise<{ affectedRows: number }> {
    return Promise.resolve({ affectedRows: 0 });
  }
  async close(): Promise<void> {}
}

const meta: PlanMeta = {
  target: 'mock',
  storageHash: 'test',
  lane: 'raw-sql',
};

test('query accepts an optional second argument carrying { signal }', () => {
  const runtime = new FixtureRuntime({
    middleware: [],
    ctx: {
      contract: {},
      mode: 'strict',
      now: () => 0,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      contentHash: async () => 'mock-hash',
      scope: 'runtime',
    },
  });
  const plan: FixturePlan = { draftId: 'd', meta };
  // All three call shapes must compile.
  void runtime.query(plan);
  void runtime.query(plan, undefined);
  void runtime.query(plan, {});
  void runtime.query(plan, { signal: new AbortController().signal });
});

test('RuntimeExecutor.execute accepts options arg', () => {
  type Executor = RuntimeExecutor<FixturePlan>;
  type ExecuteParams = Parameters<Executor['execute']>;
  expectTypeOf<ExecuteParams[1]>().toEqualTypeOf<
    | { readonly signal?: AbortSignal; readonly scope?: 'runtime' | 'connection' | 'transaction' }
    | undefined
  >();
});
