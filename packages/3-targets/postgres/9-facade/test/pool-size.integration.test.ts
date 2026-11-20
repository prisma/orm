import { randomUUID } from 'node:crypto';
import { ifDefined } from '@internal/utils/defined';
import { createDevDatabase, timeouts } from '@repo/test-utils';
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

const maintenanceUrl =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/postgres';

async function onMaintenanceConnection<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: maintenanceUrl });
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

function useServer(start: () => Promise<Server>): {
  open(poolOptions?: PostgresPoolOptions): Promise<Db>;
} {
  let server: Server | undefined;
  const clients: Db[] = [];

  beforeEach(async () => {
    server = await start();
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    for (const db of clients.splice(0)) await db.close();
    await server?.close();
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
  };
}

function readRows(db: Db): Promise<unknown[]> {
  return db
    .query(db.raw.sql`SELECT id FROM pool_rows`.returnsRow({ id: 'pg/int4@1' }).build())
    .toArray();
}

/** Opens a transaction that inserts a row and stays open until `end` is called. */
function openTransaction(db: Db) {
  let end: (outcome: 'commit' | 'rollback') => void = () => {};
  const ended = new Promise<'commit' | 'rollback'>((resolve) => {
    end = resolve;
  });
  let inserted: () => void = () => {};
  const insertedRow = new Promise<void>((resolve) => {
    inserted = resolve;
  });
  const done = db.transaction(async (tx) => {
    await tx.execute(tx.raw.sql`INSERT INTO pool_rows VALUES (1)`.affectedCount().build());
    inserted();
    if ((await ended) === 'rollback') throw new Error('roll back');
  });
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

/**
 * The dev database accepts one connection at a time, so only a real server shows that a query
 * from outside the transaction waits because of `max` and not because of the server.
 */
const servers = [
  { name: 'the dev database', start: startDevDatabase },
  ...(realPostgresAvailable ? [{ name: 'a PostgreSQL server', start: createRealDatabase }] : []),
];

describe.each(servers)('postgres() with poolOptions.max of 1, on $name', ({ start }) => {
  const server = useServer(start);

  it(
    'runs a query from outside an open transaction only after it commits',
    async () => {
      const db = await server.open({ max: 1, connectionTimeoutMillis: timeouts.databaseOperation });
      const transaction = openTransaction(db);
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
      const db = await server.open({ max: 1, connectionTimeoutMillis: timeouts.databaseOperation });
      const transaction = openTransaction(db);
      await transaction.insertedRow;

      const read = readRows(db);
      expect(await settlesWithin(read, timeouts.default)).toBe(false);

      transaction.end('rollback');
      await expect(transaction.done).rejects.toThrow('roll back');
      expect(await read).toEqual([]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'fails a query from outside a transaction held past connectionTimeoutMillis, and the transaction still commits',
    async () => {
      const db = await server.open({ max: 1, connectionTimeoutMillis: timeouts.default });
      const transaction = openTransaction(db);
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
});

describe.runIf(realPostgresAvailable)(
  'postgres() with the default pool size, on a PostgreSQL server',
  () => {
    const server = useServer(createRealDatabase);

    it(
      'runs a query from outside an open transaction on another connection, which does not see its row',
      async () => {
        const db = await server.open();
        const transaction = openTransaction(db);
        await transaction.insertedRow;

        expect(await readRows(db)).toEqual([]);

        transaction.end('commit');
        await transaction.done;
      },
      timeouts.spinUpPpgDev,
    );
  },
);
