import type { PlanMeta } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/execution/query-plan';
import { RuntimeCore } from '../src/execution/runtime-core';
import { isRuntimeError } from '../src/execution/runtime-error';
import type { ActivityContextFields, RuntimeMiddleware } from '../src/execution/runtime-middleware';
import type { CodecCallContext } from '../src/shared/codec-types';

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

class CtxRecordingRuntime extends RuntimeCore<MockPlan, MockExec, RuntimeMiddleware<MockExec>> {
  observedCtx: CodecCallContext | undefined;
  lowerCalls = 0;

  protected override lower(plan: MockPlan, ctx: CodecCallContext): MockExec {
    this.lowerCalls += 1;
    this.observedCtx = ctx;
    return { compiledId: plan.draftId, meta: plan.meta };
  }

  protected override runDriver(): AsyncIterable<Record<string, unknown>> {
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>> {
        yield { ok: true };
      },
    };
  }

  protected override runExecute(): Promise<{ affectedRows: number }> {
    return Promise.resolve({ affectedRows: 0 });
  }

  override async close(): Promise<void> {}
}

const ctxValue: ActivityContextFields = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
  contentHash: async () => 'mock-hash',
  scope: 'runtime',
};

const plan: MockPlan = { draftId: 'd', meta };

describe('RuntimeCore.query(plan, options?)', () => {
  it('accepts query(plan) with no options and threads a ctx with undefined signal', async () => {
    const runtime = new CtxRecordingRuntime({ middleware: [], ctx: ctxValue });
    const out = await runtime.query(plan).toArray();
    expect(out).toEqual([{ ok: true }]);
    expect(runtime.observedCtx).toBeDefined();
    expect(runtime.observedCtx?.signal).toBeUndefined();
  });

  it('accepts query(plan, undefined) and query(plan, {}) with undefined signal', async () => {
    const runtime = new CtxRecordingRuntime({ middleware: [], ctx: ctxValue });
    await runtime.query(plan, undefined).toArray();
    await runtime.query(plan, {}).toArray();
    expect(runtime.observedCtx).toBeDefined();
    expect(runtime.observedCtx?.signal).toBeUndefined();
  });

  it('threads ctx (carrying the signal) into lower() when signal is present', async () => {
    const runtime = new CtxRecordingRuntime({ middleware: [], ctx: ctxValue });
    const controller = new AbortController();
    await runtime.query(plan, { signal: controller.signal }).toArray();
    expect(runtime.observedCtx).toBeDefined();
    expect(runtime.observedCtx?.signal).toBe(controller.signal);
  });

  it('rejects on first next() with RUNTIME.ABORTED when signal is already aborted at entry', async () => {
    const runtime = new CtxRecordingRuntime({ middleware: [], ctx: ctxValue });
    const controller = new AbortController();
    controller.abort();
    let observed: unknown;
    try {
      await runtime.query(plan, { signal: controller.signal }).toArray();
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeDefined();
    expect(isRuntimeError(observed)).toBe(true);
    if (isRuntimeError(observed)) {
      expect(observed.code).toBe('RUNTIME.ABORTED');
      expect(observed.details).toEqual({ phase: 'stream' });
    }
    expect(runtime.lowerCalls).toBe(0);
  });

  it('attaches the signal reason as cause on already-aborted entry', async () => {
    const runtime = new CtxRecordingRuntime({ middleware: [], ctx: ctxValue });
    const controller = new AbortController();
    const reason = new Error('caller cancelled');
    controller.abort(reason);
    let observed: unknown;
    try {
      await runtime.query(plan, { signal: controller.signal }).toArray();
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeDefined();
    expect(isRuntimeError(observed)).toBe(true);
    if (isRuntimeError(observed)) {
      expect(observed.code).toBe('RUNTIME.ABORTED');
      expect(observed.cause).toBe(reason);
    }
  });
});
