import type { PlanMeta } from '@internal/contract/types';
import type {
  ActivityContextFields,
  CrossFamilyMiddleware,
  ExecutionPlan,
  QueryPlan,
  RuntimeMiddleware,
} from '@internal/framework-components/runtime';
import { RuntimeCore } from '@internal/framework-components/runtime';
import type { MongoAdapter, MongoDriver } from '@internal/mongo-lowering';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoExecutionContext,
  type MongoRuntimeAdapterDescriptor,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { describe, expect, it, vi } from 'vitest';
import { fixtureContract } from '../mongo/setup';

/**
 * Minimal cross-family observer for tests. Records `beforeEncode` and
 * `activityEnded` events into an array; declares no `familyId`/`targetId`
 * so it composes against any runtime that satisfies the framework SPI.
 *
 * This is the structural shape that the (now-retired)
 * `@internal/middleware-telemetry` package shipped as a
 * proof-of-concept; the cross-family contract is now exercised by the
 * real `@internal/middleware-cache` package (see
 * `middleware-cache.test.ts` and `examples/mongo-demo`). The tests in
 * this file remain useful for asserting composition order and the
 * `source: 'driver' | 'middleware'` round-trip without coupling to a
 * specific middleware package.
 */
interface ObservedEvent {
  readonly phase: 'beforeEncode' | 'activityEnded';
  readonly lane: string;
  readonly target: string;
  readonly storageHash: string;
  readonly rowCount?: number;
  readonly outcome?: string;
  readonly source?: 'driver' | 'middleware';
}

function collectingObserver() {
  const events: ObservedEvent[] = [];
  const middleware: CrossFamilyMiddleware = {
    name: 'observer',
    async beforeEncode(plan: { readonly meta: PlanMeta }) {
      events.push({
        phase: 'beforeEncode',
        lane: plan.meta.lane,
        target: plan.meta.target,
        storageHash: plan.meta.storageHash,
      });
    },
    async activityEnded(activity, result) {
      if (activity.kind !== 'statement' || result.kind !== 'statement') return;
      const { meta } = activity.plan;
      events.push({
        phase: 'activityEnded',
        lane: meta.lane,
        target: meta.target,
        storageHash: meta.storageHash,
        ...(result.returns === 'rows' ? { rowCount: result.rowCount } : {}),
        outcome: result.outcome,
        source: result.source,
      });
    },
  };
  return { middleware, events };
}

interface MockSqlPlan extends QueryPlan {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface MockSqlExec extends ExecutionPlan {
  readonly sql: string;
  readonly params: readonly unknown[];
}

class MockSqlRuntime extends RuntimeCore<MockSqlPlan, MockSqlExec, RuntimeMiddleware<MockSqlExec>> {
  // Exposed so tests can assert whether the underlying "driver" was hit
  // (e.g. confirming that an `intercept.onQuery` middleware short-circuited
  // execution). Symmetric with the Mongo mock's `driver.execute` spy.
  readonly driverSpy = vi.fn<(exec: MockSqlExec) => void>();

  constructor(
    middleware: ReadonlyArray<RuntimeMiddleware<MockSqlExec>>,
    ctx: ActivityContextFields,
    private readonly rows: ReadonlyArray<Record<string, unknown>>,
  ) {
    super({ middleware, ctx });
  }

  protected lower(plan: MockSqlPlan): MockSqlExec {
    return { sql: plan.sql, params: plan.params, meta: plan.meta };
  }

  protected runDriver(exec: MockSqlExec): AsyncIterable<Record<string, unknown>> {
    this.driverSpy(exec);
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

function createMockMongoAdapter(): MongoAdapter {
  // Mirrors the real two-phase adapter: `structuralLower` produces a draft that
  // keeps the command intact, and `resolveParams` turns that draft into the
  // wire command. `lower` is retained as the composed one-shot equivalent.
  const structuralLower = vi.fn((plan: MongoQueryPlan) => ({
    kind: plan.command.kind,
    collection: plan.collection,
    command: plan.command,
  }));
  const resolveParams = vi.fn((draft: { collection: string; command: unknown }) => ({
    collection: draft.collection,
    command: draft.command,
  }));
  return {
    structuralLower,
    resolveParams,
    lower: vi.fn((plan: MongoQueryPlan) => resolveParams(structuralLower(plan))),
  } as unknown as MongoAdapter;
}

// A minimal Mongo runtime adapter descriptor that wraps a caller-supplied
// `MongoAdapter` mock. We compose it through the production
// `createMongoExecutionStack` + `createMongoExecutionContext` path so the
// runtime's expectations on stack/context structure are exercised end-to-end
// even with a stub adapter.
function mockAdapterDescriptor(adapter: MongoAdapter): MongoRuntimeAdapterDescriptor<'mongo'> {
  return {
    kind: 'adapter',
    id: 'mongo',
    familyId: 'mongo',
    targetId: 'mongo',
    version: '0.0.1',
    codecs: () => mongoRuntimeTarget.codecs(),
    create: () => ({
      familyId: 'mongo',
      targetId: 'mongo',
      lower: adapter.lower.bind(adapter),
      structuralLower: adapter.structuralLower.bind(adapter),
      resolveParams: adapter.resolveParams.bind(adapter),
    }),
  };
}

function makeMongoExecution(adapter: MongoAdapter): {
  readonly context: MongoExecutionContext<typeof fixtureContract>;
  readonly adapter: MongoAdapter;
} {
  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mockAdapterDescriptor(adapter),
  });
  return {
    context: createMongoExecutionContext({ contract: fixtureContract, stack }),
    adapter: stack.adapter.create(stack),
  };
}

function createMockMongoDriver(rows: Record<string, unknown>[] = []): MongoDriver {
  return {
    execute: vi.fn(async function* <Row>() {
      for (const row of rows) {
        yield row as Row;
      }
    }),
    close: vi.fn(async () => {}),
  } as unknown as MongoDriver;
}

const mongoMeta: PlanMeta = {
  target: 'mongo',
  targetFamily: 'mongo',
  storageHash: 'mongo-test',
  lane: 'orm',
};

function createMongoPlan(meta: PlanMeta = mongoMeta): MongoQueryPlan {
  return {
    collection: 'users',
    command: { kind: 'find', filter: {} },
    meta,
  } as unknown as MongoQueryPlan;
}

const sqlCtx: ActivityContextFields = {
  contract: {},
  mode: 'strict',
  now: () => Date.now(),
  log: { info: () => {}, warn: () => {}, error: () => {} },
  contentHash: async () => 'mock-hash',
  scope: 'runtime',
};

describe('cross-family middleware proof', () => {
  it('same middleware observes queries from an SQL runtime', async () => {
    const { middleware, events } = collectingObserver();

    const sqlRuntime = new MockSqlRuntime([middleware], sqlCtx, [{ id: 1, name: 'Alice' }]);

    const sqlPlan: MockSqlPlan = {
      sql: 'SELECT id, name FROM users',
      params: [],
      meta: {
        target: 'postgres',
        storageHash: 'sql-test',
        lane: 'sql',
      },
    };

    for await (const _row of sqlRuntime.query(sqlPlan)) {
      void _row;
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      phase: 'beforeEncode',
      lane: 'sql',
      target: 'postgres',
      storageHash: 'sql-test',
    });
    expect(events[1]).toMatchObject({
      phase: 'activityEnded',
      lane: 'sql',
      target: 'postgres',
      rowCount: 1,
      outcome: 'succeeded',
    });
  });

  it('same middleware observes queries from a Mongo runtime', async () => {
    const { middleware, events } = collectingObserver();

    const mongoAdapter = createMockMongoAdapter();
    const mongoRuntime = createMongoRuntime({
      ...makeMongoExecution(mongoAdapter),
      driver: createMockMongoDriver([
        { _id: '1', name: 'Bob' },
        { _id: '2', name: 'Carol' },
      ]),
      middleware: [middleware],
    });

    const plan = createMongoPlan(mongoMeta);

    for await (const _row of mongoRuntime.query(plan)) {
      void _row;
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      phase: 'beforeEncode',
      lane: 'orm',
      target: 'mongo',
      storageHash: 'mongo-test',
    });
    expect(events[1]).toMatchObject({
      phase: 'activityEnded',
      rowCount: 2,
      outcome: 'succeeded',
    });
  });

  it('same middleware instance works across SQL and Mongo runtimes', async () => {
    const { middleware, events } = collectingObserver();

    const sqlRuntime = new MockSqlRuntime([middleware], sqlCtx, [{ id: 1 }]);

    const mongoAdapter = createMockMongoAdapter();
    const mongoRuntime = createMongoRuntime({
      ...makeMongoExecution(mongoAdapter),
      driver: createMockMongoDriver([{ _id: '1' }]),
      middleware: [middleware],
    });

    const sqlPlan2: MockSqlPlan = {
      sql: 'SELECT 1',
      params: [],
      meta: {
        target: 'postgres',
        storageHash: 'sql-hash',
        lane: 'sql',
      },
    };

    for await (const _row of sqlRuntime.query(sqlPlan2)) {
      void _row;
    }

    const mongoPlan = createMongoPlan({
      target: 'mongo',
      targetFamily: 'mongo',
      storageHash: 'mongo-hash',
      lane: 'orm',
    });

    for await (const _row of mongoRuntime.query(mongoPlan)) {
      void _row;
    }

    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ target: 'postgres', lane: 'sql' });
    expect(events[1]).toMatchObject({ target: 'postgres', outcome: 'succeeded' });
    expect(events[2]).toMatchObject({ target: 'mongo', lane: 'orm' });
    expect(events[3]).toMatchObject({ target: 'mongo', outcome: 'succeeded' });
  });

  it('same intercept.onQuery middleware short-circuits queries in both SQL and Mongo runtimes', async () => {
    // A generic interceptor with no familyId. The same instance is registered
    // on both runtimes and short-circuits execution in each. Demonstrates
    // that the intercept handler is family-agnostic by construction: both
    // runtimes run statements through the framework's statement runner,
    // so no per-family wiring is needed.
    const { middleware: observer, events } = collectingObserver();

    const onQueryCalls: string[] = [];
    const interceptor: CrossFamilyMiddleware = {
      name: 'mock-interceptor',
      intercept: {
        async onQuery(plan) {
          onQueryCalls.push(plan.meta.target);
          return { rows: [{ intercepted: true }] };
        },
      },
    };

    const sqlDriverRows: Record<string, unknown>[] = [{ id: 'should-not-appear' }];
    const sqlRuntime = new MockSqlRuntime([interceptor, observer], sqlCtx, sqlDriverRows);

    const mongoAdapter = createMockMongoAdapter();
    const mongoDriver = createMockMongoDriver([{ _id: 'should-not-appear' }]);
    const mongoRuntime = createMongoRuntime({
      ...makeMongoExecution(mongoAdapter),
      driver: mongoDriver,
      middleware: [interceptor, observer],
    });

    const sqlPlan: MockSqlPlan = {
      sql: 'SELECT 1',
      params: [],
      meta: {
        target: 'postgres',
        storageHash: 'sql-hash',
        lane: 'sql',
      },
    };

    const sqlOut: unknown[] = [];
    for await (const row of sqlRuntime.query(sqlPlan)) {
      sqlOut.push(row);
    }

    const mongoPlan = createMongoPlan({
      target: 'mongo',
      targetFamily: 'mongo',
      storageHash: 'mongo-hash',
      lane: 'orm',
    });

    const mongoOut: unknown[] = [];
    for await (const row of mongoRuntime.query(mongoPlan)) {
      mongoOut.push(row);
    }

    // The same intercepted rows came out of both runtimes.
    expect(sqlOut).toEqual([{ intercepted: true }]);
    expect(mongoOut).toEqual([{ intercepted: true }]);

    // The interceptor was invoked once per family.
    expect(onQueryCalls).toEqual(['postgres', 'mongo']);

    // Neither underlying driver was invoked: `intercept.onQuery` short-circuited
    // execution before lowering on both sides.
    expect(sqlRuntime.driverSpy).not.toHaveBeenCalled();
    expect(mongoDriver.execute).not.toHaveBeenCalled();

    // The observer saw both beforeEncode and activityEnded for each run
    // (beforeEncode fires pre-encode regardless of whether the interceptor
    // short-circuits the driver path) and saw source: 'middleware' on the
    // activityEnded events.
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      phase: 'beforeEncode',
      target: 'postgres',
    });
    expect(events[1]).toMatchObject({
      phase: 'activityEnded',
      target: 'postgres',
      outcome: 'succeeded',
      source: 'middleware',
    });
    expect(events[2]).toMatchObject({
      phase: 'beforeEncode',
      target: 'mongo',
    });
    expect(events[3]).toMatchObject({
      phase: 'activityEnded',
      target: 'mongo',
      outcome: 'succeeded',
      source: 'middleware',
    });
  });
});
