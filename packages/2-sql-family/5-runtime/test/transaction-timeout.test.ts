import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withTransaction } from '../src/sql-runtime';
import { deferred } from './closed-runtime-stub';
import { createSetup, failingDecodePlan, names, rawPlan } from './transaction-activity-fixtures';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2147483648])(
  'refuses invalid timeout %s before acquisition',
  async (timeout) => {
    const { runtime, driver } = createSetup();
    const callback = vi.fn(async () => {});
    await expect(withTransaction(runtime, callback, { timeout })).rejects.toMatchObject({
      code: 'RUNTIME.INVALID_TRANSACTION_TIMEOUT',
    });
    expect(driver.acquireConnection).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await runtime.close();
  },
);

it.each([undefined, null, 1, 2147483647])(
  'accepts timeout %s without retaining a timer after success',
  async (timeout) => {
    const { runtime, events } = createSetup();
    await expect(withTransaction(runtime, async () => 42, { timeout })).resolves.toBe(42);
    expect(
      names(events).filter((name) => ['commit', 'rollback', 'release'].includes(name)),
    ).toEqual(['commit', 'release']);
    expect(vi.getTimerCount()).toBe(0);
    await runtime.close();
  },
);

it.each(['resolve', 'reject'] as const)(
  'expires a hung callback, waits for cleanup, and contains late %s',
  async (settlement) => {
    const disposal = deferred();
    const entered = deferred();
    let rejectLate = (_error: unknown) => {};
    let resolveLate = () => {};
    const callback = new Promise<void>((resolve, reject) => {
      rejectLate = reject;
      resolveLate = resolve;
    });
    const { runtime, driver, events } = createSetup();
    const physical = await driver.acquireConnection();
    vi.mocked(physical.destroy).mockImplementation(async () => {
      await disposal.promise;
      events.push({ name: 'destroy' });
    });
    let ended = false;
    const run = withTransaction(
      runtime,
      async (tx) => {
        entered.resolve();
        await callback;
        await tx.execute(rawPlan('late'));
      },
      { timeout: 10 },
    );
    void run.then(
      () => {
        ended = true;
      },
      () => {
        ended = true;
      },
    );
    const rejected = expect(run).rejects.toMatchObject({
      code: 'RUNTIME.TRANSACTION_TIMEOUT',
      details: { timeout: 10 },
    });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(10);
    expect(ended).toBe(false);
    expect(names(events)).not.toContain('release');
    disposal.resolve();
    await rejected;
    if (settlement === 'reject') rejectLate(new Error('late callback failure'));
    else resolveLate();
    await vi.advanceTimersByTimeAsync(100);
    expect(driver.execute).not.toHaveBeenCalled();
    expect(
      names(events).filter((name) => ['commit', 'rollback', 'release', 'destroy'].includes(name)),
    ).toEqual(['destroy']);
    expect(
      names(events).filter((name) => name === 'finalized:transaction:rolled-back'),
    ).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    await runtime.close();
  },
);

it.each(['success', 'failure', 'timeout'] as const)(
  'removes the transaction abort listener after %s',
  async (outcome) => {
    const { runtime } = createSetup();
    const connection = await runtime.connection();
    const tx = await connection.transaction({ timeout: 10 });
    const add = vi.spyOn(tx.signal, 'addEventListener');
    const remove = vi.spyOn(tx.signal, 'removeEventListener');
    vi.spyOn(connection, 'transaction').mockResolvedValue(tx);
    const run = withTransaction(
      { connection: async () => connection },
      async () => {
        if (outcome === 'failure') throw new Error('callback');
        if (outcome === 'timeout') await new Promise<void>(() => {});
        return 42;
      },
      { timeout: 10 },
    );
    const checked =
      outcome === 'success' ? expect(run).resolves.toBe(42) : expect(run).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(10);
    await checked;
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
    expect(vi.getTimerCount()).toBe(0);
    await runtime.close();
  },
);

it('checks monotonic time before commit even when the timer has not run', async () => {
  const entered = deferred();
  const resume = deferred();
  const { runtime, events } = createSetup();
  const run = withTransaction(
    runtime,
    async () => {
      entered.resolve();
      await resume.promise;
    },
    { timeout: 10 },
  );
  const rejected = expect(run).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
  await entered.promise;
  vi.spyOn(performance, 'now').mockReturnValue(20);
  resume.resolve();
  await rejected;
  expect(names(events)).not.toContain('commit');
  expect(vi.getTimerCount()).toBe(0);
  await runtime.close();
});

it('excludes acquisition and BEGIN but starts the clock before post-BEGIN setup', async () => {
  const acquisition = deferred();
  const beginning = deferred();
  const setup = deferred();
  const acquired = deferred();
  const begun = deferred();
  const postBegin = deferred();
  const { runtime, driver, events } = createSetup();
  const physical = await driver.acquireConnection();
  const originalBegin = vi.mocked(physical.beginTransaction).getMockImplementation();
  if (originalBegin === undefined) throw new Error('Missing BEGIN fixture');
  vi.spyOn(physical, 'beginTransaction').mockImplementation(async (options) => {
    begun.resolve();
    await beginning.promise;
    return originalBegin(options);
  });
  const originalConnection = runtime.connection.bind(runtime);
  vi.spyOn(runtime, 'connection').mockImplementation(async () => {
    acquired.resolve();
    await acquisition.promise;
    const connection = await originalConnection();
    const transaction = connection.transaction.bind(connection);
    vi.spyOn(connection, 'transaction').mockImplementation(async (...args) => {
      const tx = await transaction(...args);
      postBegin.resolve();
      await setup.promise;
      return tx;
    });
    return connection;
  });
  const callback = vi.fn(async () => {});
  const run = withTransaction(runtime, callback, { timeout: 10 });
  const rejected = expect(run).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
  await acquired.promise;
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
  acquisition.resolve();
  await begun.promise;
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
  beginning.resolve();
  await postBegin.promise;
  await vi.advanceTimersByTimeAsync(10);
  setup.resolve();
  await rejected;
  expect(callback).not.toHaveBeenCalled();
  expect(names(events)).not.toContain('commit');
  expect(vi.getTimerCount()).toBe(0);
  await runtime.close();
});

it('does not time out an admitted slow COMMIT', async () => {
  const commit = deferred();
  const { runtime, events } = createSetup({ failures: { commitHeldUntil: commit.promise } });
  const run = withTransaction(runtime, async () => 42, { timeout: 10 });
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(names(events)).not.toContain('rollback');
  commit.resolve();
  await expect(run).resolves.toBe(42);
  await runtime.close();
});

it('preserves a callback rejection selected before expiry while rollback waits', async () => {
  const rollback = deferred();
  const failure = new Error('callback failed');
  const { runtime, events } = createSetup({ failures: { rollbackHeldUntil: rollback.promise } });
  const run = withTransaction(
    runtime,
    async () => {
      throw failure;
    },
    { timeout: 10 },
  );
  const rejected = expect(run).rejects.toBe(failure);
  await vi.advanceTimersByTimeAsync(100);
  expect(vi.getTimerCount()).toBe(0);
  rollback.resolve();
  await rejected;
  expect(names(events).filter((name) => name === 'rollback')).toHaveLength(1);
  await runtime.close();
});

it('preserves timeout when destruction fails without attempting rollback or release', async () => {
  const rollbackError = new Error('rollback failed');
  const { runtime, events } = createSetup({
    failures: { rollback: rollbackError, destroy: new Error('destroy failed') },
  });
  const run = withTransaction(runtime, async () => new Promise<void>(() => {}), { timeout: 10 });
  const rejected = expect(run).rejects.toMatchObject({
    code: 'RUNTIME.TRANSACTION_TIMEOUT',
    details: { timeout: 10 },
  });
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(
    names(events).filter((name) => ['commit', 'rollback', 'release', 'destroy'].includes(name)),
  ).toEqual(['destroy']);
  expect(vi.getTimerCount()).toBe(0);
  await runtime.close();
});

it('finalizes abandoned transaction activities without replacing timeout on hook failure', async () => {
  const hookError = new Error('hook failed');
  const error = vi.fn();
  const { runtime, events } = createSetup({
    log: { error, info: vi.fn(), warn: vi.fn() },
    middleware: [
      {
        name: 'failing-end',
        async activityEnded(activity) {
          if (activity.kind === 'transaction') throw hookError;
        },
      },
    ],
  });
  const run = withTransaction(runtime, async () => new Promise<void>(() => {}), { timeout: 10 });
  const rejected = expect(run).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(10);
  await rejected;
  expect(error).toHaveBeenCalledWith({
    event: 'middleware.activityEnded.error',
    error: hookError,
    middleware: 'failing-end',
  });
  expect(names(events).filter((name) => ['rollback', 'release', 'destroy'].includes(name))).toEqual(
    ['destroy'],
  );
  expect(vi.getTimerCount()).toBe(0);
  await runtime.close();
});

it.each(['execute', 'prepared'] as const)(
  'contains late %s middleware work and escaped lazy results after expiry',
  async (operation) => {
    const entered = deferred();
    const resume = deferred();
    const { runtime, driver, events } = createSetup({
      middleware: [
        {
          name: 'held-encoding',
          async beforeEncode() {
            entered.resolve();
            await resume.promise;
          },
        },
      ],
    });
    const prepared = await runtime.prepare({}, () => failingDecodePlan());
    let escaped: (() => Promise<unknown>) | undefined;
    const run = withTransaction(
      runtime,
      async (tx) => {
        const lazy = tx.query(rawPlan('select escaped'));
        escaped = () => lazy.toArray();
        if (operation === 'execute') await tx.execute(rawPlan('update t set x = 1'));
        else await prepared.query(tx, {}).toArray();
      },
      { timeout: 10 },
    );
    const rejected = expect(run).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    if (escaped === undefined) throw new Error('Missing escaped result');
    await expect(escaped()).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_CLOSED' });
    resume.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.execute).not.toHaveBeenCalled();
    expect(driver.query).not.toHaveBeenCalled();
    expect(names(events).filter((name) => name === 'finalized:statement:rolled-back')).toHaveLength(
      1,
    );
    expect(names(events)).not.toContain('rollback');
    expect(names(events)).not.toContain('release');
    expect(names(events).filter((name) => name === 'destroy')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    await runtime.close();
  },
);

it('passes isolation alone to BEGIN and preserves a failed COMMIT outcome without a timer', async () => {
  const commitError = new Error('commit failed');
  const { runtime, driver } = createSetup({ failures: { commit: commitError } });
  const physical = await driver.acquireConnection();
  await expect(
    withTransaction(runtime, async () => {}, { timeout: 10, isolationLevel: 'Serializable' }),
  ).rejects.toMatchObject({
    code: 'RUNTIME.TRANSACTION_COMMIT_FAILED',
    cause: commitError,
    details: { commitError },
  });
  expect(physical.beginTransaction).toHaveBeenCalledExactlyOnceWith({
    isolationLevel: 'Serializable',
  });
  expect(vi.getTimerCount()).toBe(0);
  await runtime.close();
});

it('clears the runtime timer when a wrapper fails after BEGIN', async () => {
  const { runtime, events } = createSetup();
  const connection = await runtime.connection();
  const begin = connection.transaction.bind(connection);
  const failure = new Error('wrapper setup failed');
  vi.spyOn(connection, 'transaction').mockImplementation(async (options) => {
    await begin(options);
    throw failure;
  });
  const callback = vi.fn(async () => {});
  await expect(
    withTransaction({ connection: async () => connection }, callback, { timeout: 10 }),
  ).rejects.toBe(failure);
  expect(callback).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(names(events).filter((name) => ['begin', 'destroy', 'release'].includes(name))).toEqual([
    'begin',
    'destroy',
  ]);
  await runtime.close();
});

it('clears timers on BEGIN failure', async () => {
  const failure = new Error('startup failed');
  const { runtime } = createSetup({ failures: { begin: failure } });
  await expect(withTransaction(runtime, async () => {}, { timeout: 10 })).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
  await runtime.close();
});
