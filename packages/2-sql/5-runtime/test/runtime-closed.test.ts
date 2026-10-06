import { describe, expect, it, vi } from 'vitest';
import {
  affectedCountPlan,
  afterRefusalBegins,
  closedError,
  createMiddlewareSpy,
  deferred,
  delay,
  outcomeWithin,
  rowsPlan,
  setup,
} from './closed-runtime-stub';

describe('the closed error', () => {
  it('names what closed the runtime and the missing await', async () => {
    const { runtime } = setup();
    await runtime.close();

    await expect(runtime.execute(affectedCountPlan())).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Runtime is closed',
      why: 'close() was called on this runtime, or on the client or connection that owns it. An await using scope calls close() when it ends.',
      fix: 'Await every query, transaction and prepared statement before close(). The usual cause is a query returned without await from an await using scope.',
    });
  });
});

describe('close()', () => {
  it('closes the driver once however often it is called', async () => {
    const { runtime, driver } = setup();

    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.close();

    expect(driver.close).toHaveBeenCalledTimes(1);
  });

  it('returns the same promise on every call', () => {
    const { runtime } = setup();

    expect(runtime.close()).toBe(runtime.close());
  });
});

describe('runtime-scope work started before close() finishes before the driver closes', () => {
  it('execute()', async () => {
    const { runtime, calls, hooks } = setup();
    const executeGate = deferred();
    hooks.execute = () => executeGate.promise;
    const settled: string[] = [];

    const pending = runtime.execute(affectedCountPlan()).finally(() => settled.push('execute'));
    const closing = runtime.close().finally(() => settled.push('close'));
    await delay(5);
    executeGate.resolve();

    await expect(pending).resolves.toEqual({ affectedRows: 1 });
    await closing;
    expect(calls).toEqual(['driver.execute', 'close', 'closed']);
    expect(settled).toEqual(['execute', 'close']);
  });

  it('a prepared execute', async () => {
    const { runtime, calls, hooks } = setup();
    const prepared = await runtime.prepare({}, () => affectedCountPlan());
    const executeGate = deferred();
    hooks.execute = () => executeGate.promise;
    const settled: string[] = [];

    const pending = prepared.execute(runtime, {}).finally(() => settled.push('execute'));
    const closing = runtime.close().finally(() => settled.push('close'));
    await delay(5);
    executeGate.resolve();

    await expect(pending).resolves.toEqual({ affectedRows: 1 });
    await closing;
    expect(calls).toEqual(['driver.execute', 'close', 'closed']);
    expect(settled).toEqual(['execute', 'close']);
  });

  it('connection()', async () => {
    const { runtime, calls, hooks } = setup();
    const acquireGate = deferred();
    hooks.acquire = () => acquireGate.promise;
    const settled: string[] = [];

    const pending = runtime.connection().finally(() => settled.push('connection'));
    const closing = runtime.close().finally(() => settled.push('close'));
    await delay(5);
    acquireGate.resolve();

    const held = await pending;
    await held.release();
    await closing;
    expect(calls).toEqual(['acquire', 'release', 'close', 'closed']);
    expect(settled).toEqual(['connection', 'close']);
  });

  it('query().toArray()', async () => {
    const { runtime, calls, hooks } = setup();
    const rowGate = deferred();
    hooks.firstRow = () => rowGate.promise;
    const settled: string[] = [];

    const pending = runtime
      .query(rowsPlan())
      .toArray()
      .finally(() => settled.push('query'));
    const closing = runtime.close().finally(() => settled.push('close'));
    await delay(5);
    rowGate.resolve();

    await expect(pending).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await closing;
    expect(calls).toEqual(['driver.query', 'close', 'closed']);
    expect(settled).toEqual(['query', 'close']);
  });
});

describe('a stream started before close()', () => {
  it('holds close() until its first row arrives, then lets the driver close while the rest is read', async () => {
    const { runtime, driver, hooks } = setup();
    const rowGate = deferred();
    hooks.firstRow = () => rowGate.promise;
    const closeGate = deferred();
    hooks.close = () => closeGate.promise;

    const iterator = runtime.query(rowsPlan())[Symbol.asyncIterator]();
    const firstRow = iterator.next();
    const closing = runtime.close();
    await delay(5);
    expect(driver.close).not.toHaveBeenCalled();

    rowGate.resolve();
    await expect(firstRow).resolves.toEqual({ done: false, value: { id: 1 } });
    await expect.poll(() => driver.close).toHaveBeenCalled();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 2 } });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 3 } });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    closeGate.resolve();
    await closing;
  });
});

describe('runtime-scope work that fails while close() waits for it', () => {
  it('does not block the close', async () => {
    const { runtime, calls, hooks } = setup();
    const executeGate = deferred();
    hooks.execute = async () => {
      await executeGate.promise;
      throw new Error('statement failed');
    };

    const pending = runtime.execute(affectedCountPlan());
    const closing = runtime.close();
    await delay(5);
    executeGate.resolve();

    await expect(pending).rejects.toThrow('statement failed');
    await closing;
    expect(calls).toEqual(['close', 'closed']);
  });
});

describe('runtime-scope work that enters in the same turn of the event loop as close()', () => {
  it('is admitted, and the driver closes after it', async () => {
    const { runtime, calls } = setup();
    const settled: string[] = [];

    const closing = runtime.close().finally(() => settled.push('close'));
    const pending = Promise.resolve()
      .then(() => runtime.execute(affectedCountPlan()))
      .finally(() => settled.push('execute'));

    await expect(pending).resolves.toEqual({ affectedRows: 1 });
    await closing;
    expect(calls).toEqual(['driver.execute', 'close', 'closed']);
    expect(settled).toEqual(['execute', 'close']);
  });
});

describe('runtime-scope work that starts in the turn of the event loop in which the previous one settled', () => {
  it('is admitted, so a chain of dependent queries completes before the driver closes', async () => {
    const { runtime, calls, hooks } = setup();
    hooks.execute = () => delay(5);

    const closing = runtime.close();
    const chain = (async () => {
      await runtime.execute(affectedCountPlan());
      await runtime.execute(affectedCountPlan());
      return runtime.query(rowsPlan()).toArray();
    })();

    await expect(chain).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await closing;
    expect(calls).toEqual(['driver.execute', 'driver.execute', 'driver.query', 'close', 'closed']);
  });
});

describe('runtime-scope work that started and ended since close() set its timer', () => {
  it('keeps the close waiting another turn, so work one turn later is still admitted', async () => {
    const { runtime, calls } = setup();

    const closing = runtime.close();
    const chain = (async () => {
      await runtime.execute(affectedCountPlan());
      await delay(0);
      return runtime.execute(affectedCountPlan());
    })();

    await expect(chain).resolves.toEqual({ affectedRows: 1 });
    await closing;
    expect(calls).toEqual(['driver.execute', 'driver.execute', 'close', 'closed']);
  });
});

describe('runtime-scope work started after close()', () => {
  function closedWithSlowDriverClose() {
    const spy = createMiddlewareSpy();
    const stub = setup({ middleware: [spy.middleware] });
    const closeGate = deferred();
    stub.hooks.close = () => closeGate.promise;
    const closing = stub.runtime.close();
    return { ...stub, ...spy, closing, closeGate };
  }

  it('execute() with a scope option is still refused, because it runs on the driver', async () => {
    const { runtime, driver, closeGate, closing } = closedWithSlowDriverClose();
    await afterRefusalBegins();

    expect(
      await outcomeWithin(runtime.execute(affectedCountPlan(), { scope: 'transaction' })),
    ).toMatchObject(closedError);
    expect(driver.execute).not.toHaveBeenCalled();
    closeGate.resolve();
    await closing;
  });

  it('execute() is refused at once, without driver calls or middleware', async () => {
    const { runtime, driver, beforeExecute, closeGate, closing } = closedWithSlowDriverClose();
    await afterRefusalBegins();

    expect(await outcomeWithin(runtime.execute(affectedCountPlan()))).toMatchObject(closedError);
    expect(driver.execute).not.toHaveBeenCalled();
    expect(beforeExecute).not.toHaveBeenCalled();
    closeGate.resolve();
    await closing;
  });

  it('query().toArray() is refused at once, without driver calls or middleware', async () => {
    const { runtime, driver, beforeQuery, closeGate, closing } = closedWithSlowDriverClose();
    await afterRefusalBegins();

    expect(await outcomeWithin(runtime.query(rowsPlan()).toArray())).toMatchObject(closedError);
    expect(driver.query).not.toHaveBeenCalled();
    expect(beforeQuery).not.toHaveBeenCalled();
    closeGate.resolve();
    await closing;
  });

  it('a prepared query and a prepared execute are refused at once, without driver calls or middleware', async () => {
    const spy = createMiddlewareSpy();
    const { runtime, driver, hooks } = setup({ middleware: [spy.middleware] });
    const preparedQuery = await runtime.prepare({}, () => rowsPlan());
    const preparedExecute = await runtime.prepare({}, () => affectedCountPlan());
    const closeGate = deferred();
    hooks.close = () => closeGate.promise;
    const closing = runtime.close();
    await afterRefusalBegins();

    expect(await outcomeWithin(preparedQuery.query(runtime, {}).toArray())).toMatchObject(
      closedError,
    );
    expect(await outcomeWithin(preparedExecute.execute(runtime, {}))).toMatchObject(closedError);
    expect(driver.query).not.toHaveBeenCalled();
    expect(driver.execute).not.toHaveBeenCalled();
    expect(spy.beforeQuery).not.toHaveBeenCalled();
    expect(spy.beforeExecute).not.toHaveBeenCalled();
    closeGate.resolve();
    await closing;
  });

  it('connection() is refused at once and acquires nothing', async () => {
    const { runtime, driver, closeGate, closing } = closedWithSlowDriverClose();
    await afterRefusalBegins();

    expect(await outcomeWithin(runtime.connection())).toMatchObject(closedError);
    expect(driver.acquireConnection).not.toHaveBeenCalled();
    closeGate.resolve();
    await closing;
  });
});

describe('close() under fake timers installed after the runtime module loaded', () => {
  it('settles without advancing the fake clock', async () => {
    const { runtime, driver, hooks } = setup();
    hooks.close = async () => {};
    vi.useFakeTimers();
    try {
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }

    expect(driver.close).toHaveBeenCalledOnce();
  }, 2000);
});

describe("a runtime whose close refuses 'at-once'", () => {
  it('refuses an operation entering in the same turn as close(), and still completes an execute() started before it', async () => {
    const { runtime, calls, hooks, driver } = setup({ closeRefusal: 'at-once' });
    hooks.execute = () => delay(5);

    const before = runtime.execute(affectedCountPlan());
    const closing = runtime.close();
    const after = runtime.execute(affectedCountPlan());

    await expect(after).rejects.toMatchObject(closedError);
    await expect(before).resolves.toEqual({ affectedRows: 1 });
    await closing;
    expect(driver.execute).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['driver.execute', 'close', 'closed']);
  });
});
