import { randomUUID } from 'node:crypto';
import { ifDefined } from '@internal/utils/defined';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { inCi } from '@repo/test-utils/ci';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresPoolOptions } from '../src/exports/runtime';
import postgres from '../src/exports/runtime';
import { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

type Db = ReturnType<typeof postgres<Contract>>;

interface Server {
  readonly url: string;
  close(): Promise<void>;
}

interface OpenTransaction {
  readonly insertedRow: Promise<void>;
  readonly done: Promise<void>;
  end(outcome: 'commit' | 'rollback'): void;
}

const maintenanceUrl =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/postgres';

async function onMaintenanceConnection<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: maintenanceUrl,
    connectionTimeoutMillis: timeouts.databaseOperation,
    query_timeout: timeouts.databaseOperation,
  });
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const realPostgresAvailable = await onMaintenanceConnection(async (client) => {
  await client.query('SELECT 1');
  return true;
}).catch(() => false);

async function startDevDatabase(): Promise<Server> {
  const database = await createDevDatabase();
  return { url: database.connectionString, close: () => database.close() };
}

async function createRealDatabase(): Promise<Server> {
  const name = `pool_size_${randomUUID().replaceAll('-', '')}`;
  await onMaintenanceConnection((client) =>
    client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`),
  );
  const url = new URL(maintenanceUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    close: async () => {
      await onMaintenanceConnection((client) =>
        client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)} WITH (FORCE)`),
      );
    },
  };
}

/** Starts a server for each test, and after it rolls back every transaction still open, closes every client and drops the server. */
function useServer(start: () => Promise<Server>): {
  open(poolOptions?: PostgresPoolOptions): Promise<Db>;
  openUnused(poolOptions: PostgresPoolOptions): Promise<Db>;
  openTransaction(db: Db): OpenTransaction;
} {
  let server: Server | undefined;
  const clients: Db[] = [];
  const transactions: OpenTransaction[] = [];

  beforeEach(async () => {
    server = await start();
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    try {
      for (const transaction of transactions.splice(0)) {
        transaction.end('rollback');
        await transaction.done.catch(() => undefined);
      }
      for (const db of clients.splice(0)) await db.close();
    } finally {
      await server?.close();
    }
  }, timeouts.spinUpPpgDev);

  return {
    async open(poolOptions) {
      if (server === undefined) throw new Error('Expected a started server');
      const db = postgres({
        contract,
        url: server.url,
        verifyMarker: false,
        ...ifDefined('poolOptions', poolOptions),
      });
      clients.push(db);
      await db.execute(db.raw.sql`CREATE TABLE pool_rows (id INT)`.affectedCount().build());
      return db;
    },
    /** Creates the table on a connection of its own, then returns a client that verifies the contract marker and has sent nothing yet. */
    async openUnused(poolOptions) {
      if (server === undefined) throw new Error('Expected a started server');
      const setup = new pg.Client({ connectionString: server.url });
      try {
        await setup.connect();
        await setup.query('CREATE TABLE pool_rows (id INT)');
      } finally {
        await setup.end();
      }
      const db = postgres({ contract, url: server.url, poolOptions });
      clients.push(db);
      return db;
    },
    openTransaction(db) {
      const transaction = openTransaction(db);
      transactions.push(transaction);
      return transaction;
    },
  };
}

function readRows(db: Db): Promise<unknown[]> {
  return db
    .query(db.raw.sql`SELECT id FROM pool_rows`.returnsRow({ id: 'pg/int4@1' }).build())
    .toArray();
}

/** Opens a transaction that inserts a row and stays open until `end` is called. */
function openTransaction(db: Db): OpenTransaction {
  let end: (outcome: 'commit' | 'rollback') => void = () => {};
  const ended = new Promise<'commit' | 'rollback'>((resolve) => {
    end = resolve;
  });
  let inserted: () => void = () => {};
  let setupFailed: (error: unknown) => void = () => {};
  const insertedRow = new Promise<void>((resolve, reject) => {
    inserted = resolve;
    setupFailed = reject;
  });
  const done = db.transaction(async (tx) => {
    await tx.execute(tx.raw.sql`INSERT INTO pool_rows VALUES (1)`.affectedCount().build());
    inserted();
    if ((await ended) === 'rollback') throw new Error('roll back');
  });
  done.catch(setupFailed);
  insertedRow.catch(() => undefined);
  return { insertedRow, end, done };
}

function settlesWithin(promise: Promise<unknown>, millis: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), millis)),
  ]);
}

it.runIf(inCi)(
  'has the PostgreSQL server its pool-size tests run against when it runs in CI',
  () => {
    expect(
      realPostgresAvailable,
      'No PostgreSQL server answers at DATABASE_URL, or at localhost:5432 when it is unset, so the pool-size tests skipped',
    ).toBe(true);
  },
);

/**
 * The dev database accepts one connection at a time, so a query from outside a transaction waits
 * there whatever the pool size. These cases need a real server to show that `max` makes it wait.
 */
describe.runIf(realPostgresAvailable)('postgres() on a PostgreSQL server', () => {
  const server = useServer(createRealDatabase);

  describe('with poolOptions.max of 1', () => {
    it(
      'runs a query from outside an open transaction only after it commits',
      async () => {
        const db = await server.open({
          max: 1,
          connectionTimeoutMillis: timeouts.databaseOperation,
        });
        const transaction = server.openTransaction(db);
        await transaction.insertedRow;

        const read = readRows(db);
        expect(await settlesWithin(read, timeouts.default)).toBe(false);

        transaction.end('commit');
        await transaction.done;
        expect(await read).toEqual([{ id: 1 }]);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'runs a query from outside an open transaction only after it rolls back',
      async () => {
        const db = await server.open({
          max: 1,
          connectionTimeoutMillis: timeouts.databaseOperation,
        });
        const transaction = server.openTransaction(db);
        await transaction.insertedRow;

        const read = readRows(db);
        expect(await settlesWithin(read, timeouts.default)).toBe(false);

        transaction.end('rollback');
        await expect(transaction.done).rejects.toThrow('roll back');
        expect(await read).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('with the default pool size', () => {
    it(
      'runs a query from outside an open transaction on another connection, which does not see its row',
      async () => {
        const db = await server.open();
        const transaction = server.openTransaction(db);
        await transaction.insertedRow;

        expect(await readRows(db)).toEqual([]);

        transaction.end('commit');
        await transaction.done;
      },
      timeouts.spinUpPpgDev,
    );
  });
});

/**
 * On the dev database a default pool also fails the outside query, but with the server's
 * connection timeout, not the pool's, so this case can fail there too.
 */
const servers = [
  { name: 'the dev database', start: startDevDatabase },
  ...(realPostgresAvailable ? [{ name: 'a PostgreSQL server', start: createRealDatabase }] : []),
];

describe.each(servers)('postgres() with poolOptions.max of 1, on $name', ({ start }) => {
  const server = useServer(start);

  it(
    'fails a query from outside a transaction held past connectionTimeoutMillis, and the transaction still commits',
    async () => {
      const db = await server.open({
        max: 1,
        connectionTimeoutMillis: timeouts.poolConnectionWait,
      });
      const transaction = server.openTransaction(db);
      await transaction.insertedRow;

      await expect(readRows(db)).rejects.toMatchObject({
        name: 'SqlConnectionError',
        kind: 'sql_connection',
        message: 'timeout exceeded when trying to connect',
      });

      transaction.end('commit');
      await transaction.done;
      expect(await readRows(db)).toEqual([{ id: 1 }]);
    },
    timeouts.spinUpPpgDev,
  );

  it.each(['the transaction', 'the query'])(
    'runs a first transaction and a first query sent together, %s first, with the contract marker check on',
    async (first) => {
      const db = await server.openUnused({
        max: 1,
        connectionTimeoutMillis: timeouts.poolConnectionWait,
      });
      const insert = () =>
        db.transaction(async (tx) => {
          await tx.execute(tx.raw.sql`INSERT INTO pool_rows VALUES (1)`.affectedCount().build());
        });

      const [transaction, read] =
        first === 'the transaction'
          ? await Promise.allSettled([insert(), readRows(db)])
          : await Promise.allSettled([readRows(db), insert()]).then(([r, t]) => [t, r] as const);

      expect(transaction).toEqual({ status: 'fulfilled', value: undefined });
      expect(read).toEqual({
        status: 'fulfilled',
        value: expect.toBeOneOf([[], [{ id: 1 }]]),
      });
      expect(await readRows(db)).toEqual([{ id: 1 }]);
    },
    timeouts.spinUpPpgDev,
  );
});
