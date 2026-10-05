import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { AfterTransactionResult } from '@internal/framework-components/runtime';
import type { SqlDriver } from '@internal/sql-relational-core/ast';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import { createSqlExecutionStack } from '../src/sql-context';
import type { Log, RuntimeConnection } from '../src/sql-runtime';
import { withTransaction } from '../src/sql-runtime';
import {
  createTestRuntime as createRuntime,
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContext,
  createTestContract,
  createTestTargetDescriptor,
  stubAst,
} from './utils';

const testContract = createTestContract({ targetFamily: 'sql', target: 'postgres' });

interface HookEvent {
  readonly name: string;
  readonly plan?: SqlExecutionPlan;
  readonly planExecutionId?: string;
}

interface DriverFailures {
  readonly query?: Error;
  readonly execute?: Error;
  readonly commit?: Error;
  readonly rollback?: Error;
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
  const settle = (name: string, failure: Error | undefined) => async () => {
    events.push({ name });
    if (failure) throw failure;
  };
  const transaction = {
    ...queryable,
    commit: vi.fn().mockImplementation(settle('commit', failures.commit)),
    rollback: vi.fn().mockImplementation(settle('rollback', failures.rollback)),
  };
  const connection = {
    ...queryable,
    beginTransaction: vi.fn().mockResolvedValue(transaction),
    release: vi.fn().mockImplementation(settle('release', undefined)),
    destroy: vi.fn().mockImplementation(settle('destroy', undefined)),
  };
  return {
    ...queryable,
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockResolvedValue(connection),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function recorder(
  events: HookEvent[],
  afterTransaction?: SqlMiddleware['afterTransaction'],
): SqlMiddleware {
  const record = (name: string, plan: SqlExecutionPlan, planExecutionId: string) => {
    events.push({ name, plan, planExecutionId });
  };
  return {
    name: 'recorder',
    familyId: 'sql',
    async beforeQuery(plan, ctx) {
      record('beforeQuery', plan, ctx.planExecutionId);
    },
    async beforeExecute(plan, ctx) {
      record('beforeExecute', plan, ctx.planExecutionId);
    },
    async afterQuery(plan, _result, ctx) {
      record('afterQuery', plan, ctx.planExecutionId);
    },
    async afterExecute(plan, _result, ctx) {
      record('afterExecute', plan, ctx.planExecutionId);
    },
    async afterTransaction(plan, result, ctx) {
      record(`afterTransaction:${result.outcome}`, plan, ctx.planExecutionId);
      await afterTransaction?.(plan, result, ctx);
    },
  };
}

function createSetup(
  options: {
    readonly failures?: DriverFailures;
    readonly afterTransaction?: SqlMiddleware['afterTransaction'];
    readonly log?: Log;
  } = {},
) {
  const events: HookEvent[] = [];
  const adapter = createStubAdapter();
  const stack = createSqlExecutionStack({
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(adapter),
    extensions: [],
  });
  const runtime = createRuntime({
    stackInstance: instantiateExecutionStack(stack),
    context: createTestContext(testContract, adapter),
    driver: createDriver(events, options.failures ?? {}),
    verifyMarker: false,
    middleware: [recorder(events, options.afterTransaction)],
    ...(options.log ? { log: options.log } : {}),
  });
  return { runtime, events };
}

const meta = {
  target: testContract.target,
  targetFamily: testContract.targetFamily,
  storageHash: testContract.storage.storageHash,
  lane: 'raw' as const,
};

function rawPlan(sql: string): SqlExecutionPlan {
  return { sql, params: [], ast: stubAst(), meta };
}

const names = (events: readonly HookEvent[]) => events.map((event) => event.name);
const afterHookNames = (events: readonly HookEvent[]) =>
  names(events).filter((name) => !name.startsWith('before'));

describe('afterTransaction outside a transaction', () => {
  const scopes = {
    runtime: async (setup: ReturnType<typeof createSetup>) => setup.runtime,
    connection: async (setup: ReturnType<typeof createSetup>) => setup.runtime.connection(),
  };

  describe.each(Object.entries(scopes))('in %s scope', (_scope, queryableOf) => {
    it('fires committed right after afterQuery', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      await queryable.query(rawPlan('select 1')).toArray();

      expect(afterHookNames(setup.events)).toEqual(['afterQuery', 'afterTransaction:committed']);
    });

    it('fires committed right after afterExecute', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      await queryable.execute(rawPlan('update t set x = 1'));

      expect(afterHookNames(setup.events)).toEqual(['afterExecute', 'afterTransaction:committed']);
    });

    it('fires committed after afterQuery when the driver throws', async () => {
      const setup = createSetup({ failures: { query: new Error('query failed') } });
      const queryable = await queryableOf(setup);

      await expect(queryable.query(rawPlan('select 1')).toArray()).rejects.toThrow('query failed');

      expect(afterHookNames(setup.events)).toEqual(['afterQuery', 'afterTransaction:committed']);
    });

    it('fires committed after afterExecute when the driver throws', async () => {
      const setup = createSetup({ failures: { execute: new Error('execute failed') } });
      const queryable = await queryableOf(setup);

      await expect(queryable.execute(rawPlan('update t set x = 1'))).rejects.toThrow(
        'execute failed',
      );

      expect(afterHookNames(setup.events)).toEqual(['afterExecute', 'afterTransaction:committed']);
    });

    it('fires committed after a prepared query and a prepared execute', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);
      const rows = await setup.runtime.prepare({}, () => ({ ast: stubAst(), params: [], meta }));
      const count = await setup.runtime.prepare({}, () =>
        planFromAst<AffectedCount>(RawQueryAst.affectedCount(['update t set x = 1']), testContract),
      );

      await rows.query(queryable, {}).toArray();
      await count.execute(queryable, {});

      expect(afterHookNames(setup.events)).toEqual([
        'afterQuery',
        'afterTransaction:committed',
        'afterExecute',
        'afterTransaction:committed',
      ]);
    });
  });

  it('passes the plan and planExecutionId the after-hook saw', async () => {
    const { runtime, events } = createSetup();

    await runtime.query(rawPlan('select 1')).toArray();

    const [afterQuery, afterTransaction] = events.filter((event) => event.name.startsWith('after'));
    expect(afterTransaction?.plan).toBe(afterQuery?.plan);
    expect(afterTransaction?.planExecutionId).toBe(afterQuery?.planExecutionId);
  });
});

type Outcome = AfterTransactionResult['outcome'];

const transactionCases: ReadonlyArray<{
  readonly title: string;
  readonly failures: DriverFailures;
  readonly callbackFails: boolean;
  readonly outcome: Outcome;
}> = [
  { title: 'commit resolves', failures: {}, callbackFails: false, outcome: 'committed' },
  {
    title: 'the callback throws and rollback resolves',
    failures: {},
    callbackFails: true,
    outcome: 'rolled-back',
  },
  {
    title: 'the callback throws and rollback rejects',
    failures: { rollback: new Error('rollback failed') },
    callbackFails: true,
    outcome: 'rolled-back',
  },
  {
    title: 'commit rejects and the cleanup rollback resolves',
    failures: { commit: new Error('commit failed') },
    callbackFails: false,
    outcome: 'unknown',
  },
  {
    title: 'commit rejects and the cleanup rollback rejects',
    failures: { commit: new Error('commit failed'), rollback: new Error('rollback failed') },
    callbackFails: false,
    outcome: 'unknown',
  },
];

describe('afterTransaction in withTransaction', () => {
  it.each(transactionCases)('fires $outcome once when $title', async (testCase) => {
    const { runtime, events } = createSetup({ failures: testCase.failures });

    const run = withTransaction(runtime, async (tx) => {
      await tx.execute(rawPlan('update t set x = 1'));
      if (testCase.callbackFails) throw new Error('callback failed');
    });

    if (testCase.outcome === 'committed') {
      await run;
    } else {
      await expect(run).rejects.toThrow();
    }
    const stageAt = names(events).indexOf(`afterTransaction:${testCase.outcome}`);
    expect(names(events).filter((name) => name.startsWith('afterTransaction'))).toEqual([
      `afterTransaction:${testCase.outcome}`,
    ]);
    expect(stageAt).toBeGreaterThan(names(events).indexOf('afterExecute'));
    expect(stageAt).toBeLessThan(
      names(events).findIndex((n) => n === 'release' || n === 'destroy'),
    );
  });
});

describe('afterTransaction on a transaction driven by hand', () => {
  async function begin(setup: ReturnType<typeof createSetup>) {
    const connection: RuntimeConnection = await setup.runtime.connection();
    const transaction = await connection.transaction();
    await transaction.execute(rawPlan('update t set x = 1'));
    return transaction;
  }

  const stages = (events: readonly HookEvent[]) =>
    names(events).filter((name) => name.startsWith('afterTransaction'));

  it('fires committed once when commit resolves', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);

    expect(stages(setup.events)).toEqual([]);
    await transaction.commit();

    expect(names(setup.events).slice(-2)).toEqual(['commit', 'afterTransaction:committed']);
    expect(stages(setup.events)).toEqual(['afterTransaction:committed']);
  });

  it('fires rolled-back once when rollback resolves', async () => {
    const setup = createSetup();
    const transaction = await begin(setup);

    await transaction.rollback();

    expect(names(setup.events).slice(-2)).toEqual(['rollback', 'afterTransaction:rolled-back']);
  });

  it('fires rolled-back once and rethrows when rollback rejects', async () => {
    const setup = createSetup({ failures: { rollback: new Error('rollback failed') } });
    const transaction = await begin(setup);

    await expect(transaction.rollback()).rejects.toThrow('rollback failed');

    expect(stages(setup.events)).toEqual(['afterTransaction:rolled-back']);
  });

  it.each([
    { title: 'resolves', failures: { commit: new Error('commit failed') } },
    {
      title: 'rejects',
      failures: { commit: new Error('commit failed'), rollback: new Error('rollback failed') },
    },
  ])(
    'fires unknown once when commit rejects and the following rollback $title',
    async ({ failures }) => {
      const setup = createSetup({ failures });
      const transaction = await begin(setup);

      await expect(transaction.commit()).rejects.toThrow('commit failed');
      expect(stages(setup.events)).toEqual(['afterTransaction:unknown']);

      await transaction.rollback().catch(() => undefined);
      expect(stages(setup.events)).toEqual(['afterTransaction:unknown']);
    },
  );

  it('fires once per plan in execution order with the plan and planExecutionId its other hooks saw', async () => {
    const setup = createSetup();
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();

    await transaction.query(rawPlan('select 1')).toArray();
    await transaction.execute(rawPlan('update t set x = 1'));
    await transaction.query(rawPlan('select 2')).toArray();
    await transaction.commit();

    const afterHooks = setup.events.filter(
      (event) => event.name === 'afterQuery' || event.name === 'afterExecute',
    );
    const stages = setup.events.filter((event) => event.name.startsWith('afterTransaction'));
    expect(stages.map((event) => event.plan?.sql)).toEqual([
      'select 1',
      'update t set x = 1',
      'select 2',
    ]);
    expect(stages.map((event) => event.plan)).toEqual(afterHooks.map((event) => event.plan));
    stages.forEach((stage, index) => {
      expect(stage.plan).toBe(afterHooks[index]?.plan);
      expect(stage.planExecutionId).toBe(afterHooks[index]?.planExecutionId);
    });
  });

  it('fires at commit for a query whose row stream the caller abandoned', async () => {
    const setup = createSetup();
    const connection = await setup.runtime.connection();
    const transaction = await connection.transaction();

    for await (const _row of transaction.query(rawPlan('select 1'))) {
      break;
    }
    expect(names(setup.events)).not.toContain('afterQuery');

    await transaction.commit();

    const [before] = setup.events.filter((event) => event.name === 'beforeQuery');
    const stages = setup.events.filter((event) => event.name.startsWith('afterTransaction'));
    expect(stages).toEqual([
      expect.objectContaining({
        name: 'afterTransaction:committed',
        planExecutionId: before?.planExecutionId,
      }),
    ]);
  });

  it('commit resolves when a hook throws, and the error is logged', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const failure = new Error('hook failed');
    const setup = createSetup({
      log,
      afterTransaction: async () => {
        throw failure;
      },
    });
    const transaction = await begin(setup);

    await expect(transaction.commit()).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'middleware.afterTransaction.error', error: failure }),
    );
  });

  it('commit resolves only after the hooks have run', async () => {
    let releaseHook = (): void => undefined;
    const hookGate = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const setup = createSetup({ afterTransaction: () => hookGate });
    const transaction = await begin(setup);

    let committed = false;
    const committing = transaction.commit().then(() => {
      committed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(committed).toBe(false);

    releaseHook();
    await committing;
    expect(committed).toBe(true);
  });
});
