import type { PlanMeta } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { AsyncIterableResult } from '../src/execution/async-iterable-result';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import { RuntimeCore } from '../src/execution/runtime-core';
import type {
  RuntimeExecutor,
  RuntimeMiddleware,
  RuntimeStatementStats,
} from '../src/execution/runtime-middleware';

interface FixturePlan extends QueryPlan {
  readonly draftId: string;
}

interface FixtureExec extends ExecutionPlan {
  readonly compiledId: string;
}

class MinimalRuntime extends RuntimeCore<FixturePlan, FixtureExec, RuntimeMiddleware<FixtureExec>> {
  protected lower(plan: FixturePlan): FixtureExec {
    return { compiledId: plan.draftId, meta: plan.meta };
  }
  protected runDriver(): AsyncIterable<Record<string, unknown>> {
    return {
      async *[Symbol.asyncIterator]() {},
    };
  }
  protected async runExecute(): Promise<{ affectedRows: number }> {
    return { affectedRows: 0 };
  }
  async close(): Promise<void> {}
}

test('a minimal RuntimeCore subclass typechecks', () => {
  expectTypeOf<typeof MinimalRuntime>().toBeConstructibleWith({
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
});

test('RuntimeCore is a RuntimeExecutor of TPlan', () => {
  expectTypeOf<MinimalRuntime>().toExtend<RuntimeExecutor<FixturePlan>>();
});

test('query(plan) enforces the TPlan constraint and returns AsyncIterableResult<Row>', () => {
  const meta: PlanMeta = {
    target: 'mock',
    storageHash: 'test',
    lane: 'raw-sql',
  };
  type Row = { id: number };
  const plan: FixturePlan & { readonly _row?: Row } = { draftId: 'd', meta };
  const runtime: MinimalRuntime = new MinimalRuntime({
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
  const result = runtime.query(plan);
  expectTypeOf(result).toEqualTypeOf<AsyncIterableResult<Row>>();
  expectTypeOf(runtime.execute(plan)).toEqualTypeOf<Promise<RuntimeStatementStats>>();
});

test('a subclass cannot declare lower returning a non-TExec type', () => {
  class WrongLowerRuntime extends RuntimeCore<
    FixturePlan,
    FixtureExec,
    RuntimeMiddleware<FixtureExec>
  > {
    // @ts-expect-error - lower must return FixtureExec | Promise<FixtureExec>
    protected lower(_plan: FixturePlan): { wrong: true } {
      return { wrong: true };
    }
    protected runDriver(): AsyncIterable<Record<string, unknown>> {
      return {
        async *[Symbol.asyncIterator]() {},
      };
    }
    protected async runExecute(): Promise<{ affectedRows: number }> {
      return { affectedRows: 0 };
    }
    async close(): Promise<void> {}
  }
  void WrongLowerRuntime;
});
