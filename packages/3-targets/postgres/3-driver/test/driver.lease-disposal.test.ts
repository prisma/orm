import type { Client, Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(cursor = false, blocked = 'blocked') {
  const entered = deferred();
  const resume = deferred();
  const close = vi.fn((done: (error?: Error) => void) => done());
  const read = vi.fn((_size: number, done: (error: null, rows: { id: number }[]) => void) =>
    done(null, [{ id: 1 }, { id: 2 }]),
  );
  const client = {
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    release: vi.fn(),
    query: vi.fn((request: unknown) => {
      if (typeof request === 'object' && request !== null && 'read' in request)
        return { read, close };
      if (
        request === blocked ||
        (typeof request === 'object' &&
          request !== null &&
          'text' in request &&
          request.text === blocked)
      ) {
        entered.resolve();
        return resume.promise.then(() => ({ rows: [], rowCount: 1 }));
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
  };
  const pool = { connect: async () => client, on: vi.fn(), end: vi.fn() };
  const driver = createBoundDriverFromBinding(
    { kind: 'pgPool', pool: pool as unknown as Pool, ownedByDriver: false },
    { disabled: !cursor, batchSize: 2 },
  );
  return { driver, client, entered, resume, read, close };
}

it.each(['release', 'destroy'] as const)(
  'invalidates queued prepared work before %s and drains the running statement',
  async (method) => {
    const { driver, client, entered, resume } = setup();
    const connection = await driver.acquireConnection();
    const running = connection.execute({ sql: 'blocked' });
    await entered.promise;
    let handle: unknown;
    const queued = connection.execute({
      sql: 'must not execute',
      preparedStatementHandle: {
        get: () => handle,
        set: (value) => {
          handle = value;
        },
      },
    });
    const rejected = expect(queued).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
    const disposing = connection[method]();
    expect(client.release).not.toHaveBeenCalled();
    resume.resolve();
    await running;
    await rejected;
    await disposing;
    await connection[method]();
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls).toEqual([[expect.objectContaining({ text: 'blocked' })]]);
    if (method === 'release') {
      const next = await driver.acquireConnection();
      await expect(next.execute({ sql: 'new lease' })).resolves.toEqual({ affectedRows: 1 });
      await expect(connection.execute({ sql: 'old lease' })).rejects.toMatchObject({
        code: 'DRIVER.NOT_CONNECTED',
      });
      await next.release();
    }
  },
);

it.each(['release', 'destroy'] as const)(
  'closes a parked cursor on %s without waiting for consumer advancement',
  async (method) => {
    const { driver, client, read, close } = setup(true);
    const connection = await driver.acquireConnection();
    const rows = connection.query<{ id: number }>({ sql: 'select id' })[Symbol.asyncIterator]();
    expect(await rows.next()).toEqual({ done: false, value: { id: 1 } });
    await connection[method]();
    expect(close).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
    const calls = client.query.mock.calls.length;
    await expect(rows.next()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(calls);
    expect(close).toHaveBeenCalledTimes(1);
  },
);

it('rolls back a transaction with a parked cursor and rejects its queued work', async () => {
  const { driver, client, close } = setup(true);
  const connection = await driver.acquireConnection();
  const tx = await connection.beginTransaction();
  const rows = tx.query({ sql: 'select id' })[Symbol.asyncIterator]();
  await rows.next();
  const queued = tx.execute({ sql: 'late' });
  const rejected = expect(queued).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  await tx.rollback();
  await rejected;
  expect(close).toHaveBeenCalledTimes(1);
  await connection.release();
  const calls = client.query.mock.calls.length;
  await expect(rows.next()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  expect(client.query).toHaveBeenCalledTimes(calls);
});

it('upgrades an in-progress release to destruction', async () => {
  const { driver, client, entered, resume } = setup();
  const connection = await driver.acquireConnection();
  const running = connection.execute({ sql: 'blocked' });
  await entered.promise;
  const releasing = connection.release();
  const destroying = connection.destroy(new Error('unsafe'));
  resume.resolve();
  await Promise.all([running, releasing, destroying]);
  expect(client.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
});

it.each([false, true])(
  'upgrades direct release during a nonstream query, owned %s',
  async (ownedByDriver) => {
    const { client, entered, resume } = setup();
    client.end.mockImplementation(async () => {
      resume.resolve();
    });
    const driver = createBoundDriverFromBinding(
      {
        kind: 'pgClient',
        client: {
          connect: client.connect,
          end: client.end,
          on: client.on,
          query: client.query,
        } as unknown as Client,
        ownedByDriver,
      },
      { disabled: true },
    );
    const connection = await driver.acquireConnection();
    const running = connection.execute({ sql: 'blocked' });
    await entered.promise;
    const releasing = connection.release();
    const destroying = connection.destroy(new Error('unsafe'));
    let disposed = false;
    const disposal = Promise.all([releasing, destroying]).then(() => {
      disposed = true;
    });
    try {
      await expect.poll(() => disposed, { timeout: 100, interval: 5 }).toBe(true);
      expect(client.end).toHaveBeenCalledTimes(ownedByDriver ? 1 : 0);
      expect(driver.state).toBe('closed');
    } finally {
      resume.resolve();
      await Promise.all([running, disposal]);
    }
  },
);

it('shares a failed upgraded direct teardown and retries the physical close', async () => {
  const { client, entered, resume } = setup();
  const failure = new Error('end failed');
  client.end.mockRejectedValueOnce(failure).mockImplementation(async () => {
    resume.resolve();
  });
  const driver = createBoundDriverFromBinding(
    {
      kind: 'pgClient',
      client: {
        connect: client.connect,
        end: client.end,
        on: client.on,
        query: client.query,
      } as unknown as Client,
      ownedByDriver: true,
    },
    { disabled: true },
  );
  const connection = await driver.acquireConnection();
  const running = connection.execute({ sql: 'blocked' });
  await entered.promise;
  const releasing = connection.release();
  const destroying = connection.destroy(failure);
  expect(destroying).toBe(releasing);
  const result = releasing.catch((error: unknown) => error);
  try {
    await expect.poll(() => client.end.mock.calls.length, { timeout: 100, interval: 5 }).toBe(1);
    expect(await result).toBe(failure);
    await connection.destroy(failure);
    expect(client.end).toHaveBeenCalledTimes(2);
    await connection.destroy();
    expect(client.end).toHaveBeenCalledTimes(2);
  } finally {
    resume.resolve();
    await Promise.allSettled([running, result]);
  }
});

it.each(['commit', 'rollback'] as const)(
  'ignores rollback of an A handle confirmed by %s while B owns a cursor',
  async (ending) => {
    const { driver, client, close } = setup(true);
    const connection = await driver.acquireConnection();
    const a = await connection.beginTransaction();
    await a[ending]();
    const b = await connection.beginTransaction();
    await b.execute({ sql: 'write B' });
    const rows = b.query({ sql: 'select B' })[Symbol.asyncIterator]();
    await rows.next();
    const calls = client.query.mock.calls.length;
    try {
      await a.rollback();
      expect(client.query).toHaveBeenCalledTimes(calls);
      expect(close).not.toHaveBeenCalled();
      expect(await rows.next()).toEqual({ done: false, value: { id: 2 } });
      await b.commit();
      expect(close).toHaveBeenCalledTimes(1);
      await connection.release();
      expect(client.release).toHaveBeenCalledExactlyOnceWith();
    } finally {
      await connection.destroy();
    }
  },
);

it('permits rollback after failed COMMIT and retries failed ROLLBACK', async () => {
  const { driver, client } = setup();
  const connection = await driver.acquireConnection();
  const tx = await connection.beginTransaction();
  const failure = new Error('settlement failed');
  client.query.mockRejectedValueOnce(failure);
  await expect(tx.commit()).rejects.toBe(failure);
  client.query.mockRejectedValueOnce(failure);
  await expect(tx.rollback()).rejects.toBe(failure);
  await tx.rollback();
  const count = client.query.mock.calls.length;
  await tx.rollback();
  expect(client.query).toHaveBeenCalledTimes(count);
  await connection.release();
  expect(client.release).toHaveBeenCalledExactlyOnceWith();
});

it('keeps failed disposal invalid and permits a disposal retry', async () => {
  const { driver, client } = setup();
  const connection = await driver.acquireConnection();
  const failure = new Error('release failed');
  client.release.mockImplementationOnce(() => {
    throw failure;
  });
  await expect(connection.release()).rejects.toBe(failure);
  await expect(connection.execute({ sql: 'late' })).rejects.toMatchObject({
    code: 'DRIVER.NOT_CONNECTED',
  });
  await connection.destroy(failure);
  await connection.destroy(failure);
  expect(client.release).toHaveBeenCalledTimes(2);
});

it('evicts a lease released while BEGIN is still running', async () => {
  const { driver, client, entered, resume } = setup(false, 'BEGIN');
  const connection = await driver.acquireConnection();
  const beginning = connection.beginTransaction();
  await entered.promise;
  const releasing = connection.release();
  resume.resolve();
  const tx = await beginning;
  await releasing;
  expect(client.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
  await expect(tx.commit()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
});

it.each([false, true])(
  'upgrades release of a direct parked driver cursor, owned %s',
  async (ownedByDriver) => {
    const { client, close } = setup(true);
    const directClient = {
      connect: client.connect,
      end: client.end,
      on: client.on,
      query: client.query,
    };
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client: directClient as unknown as Client, ownedByDriver },
      { batchSize: 2 },
    );
    const rows = driver.query({ sql: 'select id' })[Symbol.asyncIterator]();
    await rows.next();
    const connection = await driver.acquireConnection();
    const releasing = connection.release();
    await Promise.all([releasing, connection.destroy(new Error('unsafe'))]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(ownedByDriver ? 1 : 0);
    expect(driver.state).toBe('closed');
  },
);

it.each([false, true])(
  'unregisters abandoned cursor cleanup when close fails %s',
  async (fails) => {
    const { driver, close } = setup(true);
    if (fails) close.mockImplementation((done) => done(new Error('close failed')));
    const added: { set: Set<unknown>; value: unknown }[] = [];
    const add = Set.prototype.add;
    const spy = vi.spyOn(Set.prototype, 'add').mockImplementation(function (
      this: Set<unknown>,
      value: unknown,
    ) {
      added.push({ set: this, value });
      return add.call(this, value);
    });
    try {
      for (let index = 0; index < 3; index++) {
        added.length = 0;
        const connection = await driver.acquireConnection();
        const rows = connection.query({ sql: 'select id' })[Symbol.asyncIterator]();
        await rows.next();
        const registrations = added.filter(
          ({ value }) =>
            typeof value === 'function' &&
            added.filter((entry) => entry.value === value).length === 2,
        );
        expect(registrations).toHaveLength(2);
        await connection.release();
        expect(registrations.map(({ set, value }) => set.has(value))).toEqual([false, false]);
      }
      expect(close).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  },
);

it('destroys a direct socket with a parked driver-level cursor', async () => {
  const { client, close } = setup(true);
  const directClient = {
    connect: client.connect,
    end: client.end,
    on: client.on,
    query: client.query,
  };
  const driver = createBoundDriverFromBinding(
    { kind: 'pgClient', client: directClient as unknown as Client, ownedByDriver: true },
    { batchSize: 2 },
  );
  const rows = driver.query({ sql: 'select id' })[Symbol.asyncIterator]();
  await rows.next();
  const connection = await driver.acquireConnection();
  await connection.destroy();
  expect(close).toHaveBeenCalledTimes(1);
  expect(client.end).toHaveBeenCalledTimes(1);
  expect(driver.state).toBe('closed');
  await expect(rows.next()).rejects.toMatchObject({ kind: 'sql_connection' });
});

it('invalidates a transaction together with its connection', async () => {
  const { driver } = setup();
  const connection = await driver.acquireConnection();
  const tx = await connection.beginTransaction();
  await connection.destroy();
  await expect(tx.commit()).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  await expect(tx.execute({ sql: 'late' })).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
});
