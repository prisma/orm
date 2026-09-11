import { RawQueryAst, type SqlDriver } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';
import {
  createStubAdapter,
  createTestContext,
  createTestContract,
  createTestRuntime,
  createTestStackInstance,
} from './utils';

const contract = createTestContract({ storageHash: 'intercepted-lifetime' });
const rowsPlan = planFromAst<{ id: number }>(
  RawQueryAst.rows(['select id'], { id: { codecId: 'pg/int4@1', nullable: false } }),
  contract,
);
const statsPlan = planFromAst<AffectedCount>(RawQueryAst.affectedCount(['update users']), contract);
const endings = [
  'commit',
  'rollback',
  'release',
  'destroy',
  'parent-release',
  'parent-destroy',
] as const;
type Ending = (typeof endings)[number];

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(
  ending: Ending,
  before?: () => Promise<void>,
  beforeRow?: () => Promise<void>,
) {
  const events: string[] = [];
  const source = async function* () {
    try {
      for (const id of [1, 2]) {
        events.push(`row:${id}`);
        await beforeRow?.();
        yield { id };
      }
    } finally {
      events.push('close');
    }
  };
  const middleware: SqlMiddleware = {
    name: 'recording-cache',
    async beforeCompile() {
      events.push('beforeCompile');
      return undefined;
    },
    async beforeQuery() {
      events.push('beforeQuery');
      await before?.();
    },
    async beforeExecute() {
      events.push('beforeExecute');
      await before?.();
    },
    async interceptQuery() {
      events.push('interceptQuery');
      return { rows: source() };
    },
    async interceptExecute() {
      events.push('interceptExecute');
      return { stats: { affectedRows: 4 } };
    },
    async afterQuery() {
      events.push('afterQuery');
    },
    async afterExecute() {
      events.push('afterExecute');
    },
  };
  const query = vi.fn().mockImplementation(async function* () {
    yield { id: 99 };
  });
  const execute = vi.fn(async () => ({ affectedRows: 99 }));
  const driverTx = { query, execute, commit: vi.fn(), rollback: vi.fn() };
  const driverConn = {
    query,
    execute,
    release: vi.fn(),
    destroy: vi.fn(),
    beginTransaction: vi.fn(async () => driverTx),
  };
  const driver: SqlDriver = {
    query,
    execute,
    connect: vi.fn(),
    close: vi.fn(),
    acquireConnection: vi.fn(async () => driverConn),
  };
  const runtime = createTestRuntime({
    stackInstance: createTestStackInstance(),
    context: createTestContext(contract, createStubAdapter()),
    driver,
    middleware: [middleware],
    verifyMarker: false,
  });
  const rows = await runtime.prepare({}, () => rowsPlan);
  const stats = await runtime.prepare({}, () => statsPlan);
  const connection = await runtime.connection();
  const transaction = await connection.transaction();
  const target = ending === 'release' || ending === 'destroy' ? connection : transaction;
  const expire = () => {
    switch (ending) {
      case 'commit':
        return transaction.commit();
      case 'rollback':
        return transaction.rollback();
      case 'release':
      case 'parent-release':
        return connection.release();
      case 'destroy':
      case 'parent-destroy':
        return connection.destroy();
    }
  };
  events.length = 0;
  return {
    events,
    query,
    execute,
    expire,
    rows: (prepared: boolean) => (prepared ? rows.query(target, {}) : target.query(rowsPlan)),
    stats: (prepared: boolean) =>
      prepared ? stats.execute(target, {}) : target.execute(statsPlan),
  };
}

describe.each(endings)('intercepted target lifetime after %s', (ending) => {
  it.each([false, true])('rejects rows before hooks (prepared: %s)', async (prepared) => {
    const f = await setup(ending);
    await f.expire();
    await expect(f.rows(prepared).toArray()).rejects.toThrow();
    expect(f.events).toEqual([]);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects statistics before hooks (prepared: %s)', async (prepared) => {
    const f = await setup(ending);
    await f.expire();
    await expect(f.stats(prepared)).rejects.toThrow();
    expect(f.events).toEqual([]);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'rejects delayed iteration before hooks (prepared: %s)',
    async (prepared) => {
      const f = await setup(ending);
      const rows = f.rows(prepared);
      await f.expire();
      await expect(rows.toArray()).rejects.toThrow();
      expect(f.events).toEqual([]);
    },
  );

  it.each([false, true])(
    'closes suspended interception without advancing source (prepared: %s)',
    async (prepared) => {
      const f = await setup(ending);
      const iterator = f.rows(prepared)[Symbol.asyncIterator]();
      expect(await iterator.next()).toEqual({ done: false, value: { id: 1 } });
      const entered = [...f.events];
      await f.expire();
      await expect(iterator.next()).rejects.toThrow();
      expect(f.events).toEqual([...entered, 'close']);
      expect(f.query).not.toHaveBeenCalled();
    },
  );
});

it.each([false, true])(
  'preserves active interception and cancellation (prepared: %s)',
  async (prepared) => {
    const f = await setup('commit');
    expect(await f.rows(prepared).toArray()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await f.stats(prepared)).toEqual({ affectedRows: 4 });
    expect(f.events).toEqual([
      ...(!prepared ? ['beforeCompile'] : []),
      'beforeQuery',
      'interceptQuery',
      'row:1',
      'row:2',
      'close',
      'afterQuery',
      ...(!prepared ? ['beforeCompile'] : []),
      'beforeExecute',
      'interceptExecute',
      'afterExecute',
    ]);
    f.events.length = 0;
    for await (const row of f.rows(prepared)) {
      expect(row).toEqual({ id: 1 });
      break;
    }
    expect(f.events).toEqual([
      ...(!prepared ? ['beforeCompile'] : []),
      'beforeQuery',
      'interceptQuery',
      'row:1',
      'close',
    ]);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  },
);

describe.each([false, true])('asynchronous target expiration (prepared: %s)', (prepared) => {
  it.each(['rows', 'stats'] as const)(
    'rejects %s interception after preparation expires',
    async (operation) => {
      let expire = async () => {};
      const f = await setup('commit', () => expire());
      expire = f.expire;
      const result = operation === 'rows' ? f.rows(prepared).toArray() : f.stats(prepared);
      await expect(result).rejects.toThrow();
      expect(f.events).toEqual([
        ...(!prepared ? ['beforeCompile'] : []),
        operation === 'rows' ? 'beforeQuery' : 'beforeExecute',
      ]);
      expect(f.query).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );

  it('rejects an in-flight intercepted row before yielding and closes its source', async () => {
    const entered = deferred();
    const resume = deferred();
    const f = await setup('commit', undefined, () => {
      entered.resolve();
      return resume.promise;
    });
    const iterator = f.rows(prepared)[Symbol.asyncIterator]();
    const pending = iterator.next();
    await entered.promise;
    const events = [...f.events];
    await f.expire();
    resume.resolve();
    await expect(pending).rejects.toThrow();
    expect(f.events).toEqual([...events, 'close']);
    expect(f.query).not.toHaveBeenCalled();
  });
});
