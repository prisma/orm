import type { PlanMeta } from '@internal/contract/types';
import type { CodecCallContext } from '@internal/framework-components/codec';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoAdapter, MongoDriver, MongoLoweredDraft } from '@internal/mongo-lowering';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import type { AnyMongoWireCommand } from '@internal/mongo-wire';
import { describe, expect, it, vi } from 'vitest';
import type {
  MongoExecutionContext,
  MongoExecutionStack,
  MongoRuntimeAdapterDescriptor,
  MongoRuntimeAdapterInstance,
  MongoRuntimeTargetDescriptor,
} from '../src/mongo-execution-stack';
import { createMongoRuntime } from '../src/mongo-runtime';

const baseMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'test',
  lane: 'orm',
};

function createPlan(overrides?: Partial<MongoQueryPlan>): MongoQueryPlan {
  return {
    collection: 'users',
    command: { kind: 'find', filter: {} },
    meta: baseMeta,
    ...overrides,
  } as MongoQueryPlan;
}

interface RecordingAdapter {
  adapter: MongoAdapter;
  observed: Array<CodecCallContext>;
  resolveCallCount: { current: number };
}

function recordingAdapter(): RecordingAdapter {
  const observed: Array<CodecCallContext> = [];
  const resolveCallCount = { current: 0 };
  const adapter = {
    lower: vi.fn(),
    structuralLower: vi.fn(
      (plan: MongoQueryPlan): MongoLoweredDraft => ({
        kind: 'rawAggregate',
        collection: plan.collection,
        pipeline: [],
      }),
    ),
    resolveParams: vi.fn(async (_draft: MongoLoweredDraft, ctx: CodecCallContext) => {
      resolveCallCount.current += 1;
      observed.push(ctx);
      return {} as unknown as AnyMongoWireCommand;
    }),
  } as unknown as MongoAdapter;
  return { adapter, observed, resolveCallCount };
}

function makeContext(adapter: MongoAdapter): MongoExecutionContext {
  const codecs: MongoCodecRegistry = newMongoCodecRegistry();
  const adapterInstance: MongoRuntimeAdapterInstance<'mongo'> = {
    familyId: 'mongo',
    targetId: 'mongo',
    lower: adapter.lower.bind(adapter),
    structuralLower: adapter.structuralLower.bind(adapter),
    resolveParams: adapter.resolveParams.bind(adapter),
  };
  const target: MongoRuntimeTargetDescriptor<'mongo'> = {
    kind: 'target',
    id: 'mongo',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    codecs: () => newMongoCodecRegistry(),
    create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
  };
  const adapterDescriptor: MongoRuntimeAdapterDescriptor<'mongo'> = {
    kind: 'adapter',
    id: 'mongo',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    codecs: () => newMongoCodecRegistry(),
    create: () => adapterInstance,
  };
  const stack: MongoExecutionStack<'mongo'> = {
    target,
    adapter: adapterDescriptor,
    driver: undefined,
    extensions: [],
  };
  return Object.freeze({ contract: {}, codecs, stack, applyMutationDefaults: () => [] });
}

function rowsDriver(rows: Record<string, unknown>[] = []): MongoDriver {
  return {
    execute: vi.fn(async function* <Row>() {
      for (const row of rows) {
        yield row as Row;
      }
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}

async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const row of iter) {
    out.push(row);
  }
  return out;
}

describe('MongoRuntime operations abort + ctx threading', () => {
  it('query(plan) with no options threads a ctx whose signal is undefined', async () => {
    const { adapter, observed } = recordingAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: rowsDriver([{ _id: '1' }]),
    });

    const rows = await drain(runtime.query(createPlan()));
    expect(rows).toHaveLength(1);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.signal).toBeUndefined();
  });

  it('query(plan, undefined) and query(plan, {}) thread ctx with undefined signal', async () => {
    const { adapter, observed } = recordingAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: rowsDriver([]),
    });

    await drain(runtime.query(createPlan(), undefined));
    await drain(runtime.query(createPlan(), {}));
    expect(observed).toHaveLength(2);
    expect(observed[0]?.signal).toBeUndefined();
    expect(observed[1]?.signal).toBeUndefined();
  });

  it('threads { signal } through query → resolveParams as a CodecCallContext (signal identity preserved)', async () => {
    const { adapter, observed } = recordingAdapter();
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver: rowsDriver([{ _id: '1' }]),
    });

    const controller = new AbortController();
    await drain(runtime.query(createPlan(), { signal: controller.signal }));

    expect(observed).toHaveLength(1);
    expect(observed[0]).toBeDefined();
    expect(observed[0]?.signal).toBe(controller.signal);
  });

  it('already-aborted signal at query() entry rejects with RUNTIME.ABORTED { phase: stream } before structuralLower or driver.execute', async () => {
    const { adapter, resolveCallCount } = recordingAdapter();
    const driver = rowsDriver([{ _id: '1' }]);
    const runtime = createMongoRuntime({
      context: makeContext(adapter),
      driver,
    });

    const controller = new AbortController();
    const reason = new Error('already aborted at runtime entry');
    controller.abort(reason);

    await expect(
      drain(runtime.query(createPlan(), { signal: controller.signal })),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'stream' },
      cause: reason,
    });
    expect(resolveCallCount.current).toBe(0);
    expect(adapter.structuralLower).not.toHaveBeenCalled();
    expect(adapter.resolveParams).not.toHaveBeenCalled();
    expect(
      (driver as unknown as { execute: { mock: { calls: unknown[] } } }).execute.mock.calls,
    ).toHaveLength(0);
  });

  it('rejects already-aborted execute before lowering or driver delegation', async () => {
    const { adapter, resolveCallCount } = recordingAdapter();
    const driver = rowsDriver([{ modifiedCount: 1 }]);
    const runtime = createMongoRuntime({ context: makeContext(adapter), driver });
    const controller = new AbortController();
    const reason = new Error('statistics execution aborted');
    controller.abort(reason);

    await expect(
      runtime.execute(createPlan(), { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ABORTED',
      details: { phase: 'stream' },
      cause: reason,
    });

    expect(resolveCallCount.current).toBe(0);
    expect(adapter.structuralLower).not.toHaveBeenCalled();
    expect(
      (driver as unknown as { execute: { mock: { calls: unknown[] } } }).execute.mock.calls,
    ).toHaveLength(0);
  });
});
