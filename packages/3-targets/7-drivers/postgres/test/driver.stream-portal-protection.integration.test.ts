/**
 * A suspended pg-cursor portal lives in the session's implicit transaction.
 * On a single-session backend behind a socket multiplexer (PGlite under
 * `prisma dev`, transaction-mode poolers), any interleaved query ends that
 * implicit transaction with its Sync and destroys the portal, producing
 * `portal "C_N" does not exist` mid-stream. The driver protects streamed
 * execution by wrapping it in an explicit transaction, which an interleaved
 * Sync cannot end.
 */

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { executeSql, queryRows } from './sql-queryable-test-utils';

interface SharedSessionHarness {
  readonly db: PGlite;
  readonly client: Client;
  readonly driver: ReturnType<typeof postgresRuntimeDriverDescriptor.create>;
  readonly recordedQueryTexts: string[];
  // How many times a Submittable (a pg-cursor) was handed to client.query.
  // Lets a test prove the streaming/cursor path was taken, so a future change
  // that buffers the result can't quietly turn the regression into a no-op.
  cursorSubmitCount(): number;
  close(): Promise<void>;
}

let harness: SharedSessionHarness | undefined;

interface QuerySpy {
  readonly texts: string[];
  cursorSubmits: number;
}

const INJECTED_COMMIT_FAILURE = 'injected COMMIT failure';

function installQuerySpy(client: Client, failCommit: boolean): QuerySpy {
  const spy: QuerySpy = { texts: [], cursorSubmits: 0 };
  const original = client.query.bind(client);
  const spied = (...args: unknown[]): unknown => {
    const first = args[0];
    let text: string | undefined;
    if (typeof first === 'string') {
      text = first;
      spy.texts.push(first);
    } else if (typeof first === 'object' && first !== null) {
      if ('text' in first && typeof (first as { text?: unknown }).text === 'string') {
        text = (first as { text: string }).text;
        spy.texts.push(text);
      }
      if ('submit' in first && typeof (first as { submit?: unknown }).submit === 'function') {
        spy.cursorSubmits += 1;
      }
    }
    // Force the stream's terminating COMMIT to fail, exercising commitStreamSpan's
    // surface-vs-swallow decision. Only COMMIT is intercepted; BEGIN, the cursor,
    // and setup queries run for real. The error carries a real SQLSTATE (25P02,
    // in_failed_sql_transaction) so the driver treats it as a genuine pg failure
    // and propagates it, rather than falling back to the buffered path.
    if (failCommit && text === 'COMMIT') {
      return Promise.reject(Object.assign(new Error(INJECTED_COMMIT_FAILURE), { code: '25P02' }));
    }
    return (original as (...inner: unknown[]) => unknown)(...args);
  };
  (client as unknown as { query: typeof spied }).query = spied;
  return spy;
}

async function createSharedSessionHarness(options?: {
  readonly cursorBatchSize?: number;
  readonly failCommit?: boolean;
}): Promise<SharedSessionHarness> {
  const db = await PGlite.create();
  // Bind to port 0 and read the port the OS actually assigned back from the
  // server. Probing for a free port up front and reusing it races another
  // listener grabbing it in the gap (a flake `prisma/prisma` hit in practice).
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  const serverConn = server.getServerConn();
  const port = Number(serverConn.slice(serverConn.lastIndexOf(':') + 1));

  const client = new Client({
    host: '127.0.0.1',
    port,
    database: 'postgres',
    user: 'postgres',
  });
  // A dropped connection makes pg emit an asynchronous 'error' event; with no
  // listener that becomes an unhandled error and fails the run. Connection
  // drops are not expected here — the listener only keeps an incidental one
  // from crashing the process; the awaited query/connect still rejects.
  client.on('error', () => {});
  await client.connect();
  const spy = installQuerySpy(client, options?.failCommit ?? false);

  const driver = postgresRuntimeDriverDescriptor.create({
    cursor: { batchSize: options?.cursorBatchSize ?? 10 },
  });
  await driver.connect({ kind: 'pgClient', client });

  const created: SharedSessionHarness = {
    db,
    client,
    driver,
    recordedQueryTexts: spy.texts,
    cursorSubmitCount: () => spy.cursorSubmits,
    // Best-effort teardown: each close is independent, so one failure must not
    // skip the others or replace the test's own result.
    close: async () => {
      await driver.close().catch(() => {});
      await server.stop().catch(() => {});
      await db.close().catch(() => {});
    },
  };
  harness = created;
  return created;
}

async function seedRows(h: SharedSessionHarness, count: number): Promise<void> {
  await executeSql(h.driver, 'create table items (id int primary key, n int not null)');
  const values = Array.from({ length: count }, (_, i) => `(${i}, ${i * 2})`).join(', ');
  await executeSql(h.driver, `insert into items (id, n) values ${values}`);
}

afterEach(async () => {
  if (harness) {
    await harness.close();
    harness = undefined;
  }
}, timeouts.spinUpDbServer);

describe('streamed execute on a shared single-session backend', () => {
  it(
    'survives a query injected into the backend session between cursor batches',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 10 });
      await seedRows(h, 30);

      const rows: Array<{ id: string }> = [];
      for await (const row of h.driver.query<{ id: string }>({
        sql: 'select id from items order by id',
      })) {
        rows.push(row);
        // Inject exactly once, right after the first cursor batch completes
        // (batchSize 10), so the portal is suspended mid-stream when the
        // interleaved query lands. This simulates the prisma dev server's
        // WAL-bridge drain: a direct PGlite query on the same backend session.
        // Its Sync must not kill the stream.
        if (rows.length === 10) {
          await h.db.query('select 1');
        }
      }

      expect(rows).toHaveLength(30);
      expect(rows[0]).toEqual({ id: '0' });
      expect(rows[29]).toEqual({ id: '29' });
      // The race only exists while a cursor holds a suspended portal; assert a
      // cursor was actually used so buffering can't turn this into a false pass.
      expect(h.cursorSubmitCount()).toBeGreaterThan(0);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'wraps top-level streamed execution in an explicit transaction',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 12);
      h.recordedQueryTexts.length = 0;

      const rows: unknown[] = [];
      for await (const row of h.driver.query({ sql: 'select id from items order by id' })) {
        rows.push(row);
      }

      expect(rows).toHaveLength(12);
      expect(h.recordedQueryTexts).toEqual(['BEGIN', 'select id from items order by id', 'COMMIT']);
      expect(h.db.isInTransaction()).toBe(false);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'commits and releases the session when the consumer abandons the stream early',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 25);
      h.recordedQueryTexts.length = 0;

      for await (const row of h.driver.query<{ id: string }>({
        sql: 'select id from items order by id',
      })) {
        if (Number(row.id) >= 6) {
          break;
        }
      }

      expect(h.recordedQueryTexts.filter((text) => text === 'BEGIN')).toHaveLength(1);
      expect(h.recordedQueryTexts.filter((text) => text === 'COMMIT')).toHaveLength(1);
      expect(h.db.isInTransaction()).toBe(false);

      const after = await queryRows<{ n: string }>(
        h.driver,
        'select count(*)::int as n from items',
      );
      expect(after).toEqual([{ n: '25' }]);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'surfaces a failing COMMIT after the stream completed',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5, failCommit: true });
      await seedRows(h, 10);

      const rows: unknown[] = [];
      let caught: unknown;
      try {
        for await (const row of h.driver.query({ sql: 'select id from items order by id' })) {
          rows.push(row);
        }
      } catch (error) {
        caught = error;
      }

      // The rows stream out first; the COMMIT failure surfaces only as the
      // generator closes, and it is not swallowed on the success path.
      expect(rows).toHaveLength(10);
      expect(caught).toBeInstanceOf(Error);
      expect(h.recordedQueryTexts).toContain('COMMIT');
    },
    timeouts.spinUpDbServer,
  );

  it(
    'lets the stream error win when both the stream and its COMMIT fail',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5, failCommit: true });
      await seedRows(h, 5);

      let caught: unknown;
      try {
        // Division by zero at id = 3 fails the stream mid-read; the terminating
        // COMMIT then also fails (injected), and must not mask the stream error.
        for await (const _row of h.driver.query({
          sql: 'select 1 / (id - 3) as x from items order by id',
        })) {
          // drain until the backend raises division_by_zero
        }
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(String((caught as Error).message)).not.toContain('injected COMMIT failure');
    },
    timeouts.spinUpDbServer,
  );

  it(
    'does not open a nested transaction when streaming inside a driver transaction',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 12);
      h.recordedQueryTexts.length = 0;

      const connection = await h.driver.acquireConnection();
      const transaction = await connection.beginTransaction();
      const rows: unknown[] = [];
      for await (const row of transaction.query({ sql: 'select id from items order by id' })) {
        rows.push(row);
      }
      await transaction.commit();
      await connection.release();

      expect(rows).toHaveLength(12);
      expect(h.recordedQueryTexts.filter((text) => text === 'BEGIN')).toHaveLength(1);
      expect(h.recordedQueryTexts.filter((text) => text === 'COMMIT')).toHaveLength(1);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'root direct-driver stream preserves an acquired connection transaction for rollback',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 8);

      const connection = await h.driver.acquireConnection();
      try {
        const transaction = await connection.beginTransaction();
        await transaction.execute({ sql: 'insert into items (id, n) values (100, 200)' });

        const rows = await queryRows<{ id: string }>(h.driver, 'select id from items order by id');
        expect(rows.at(-1)).toEqual({ id: '100' });
        expect(h.cursorSubmitCount()).toBeGreaterThan(0);

        await transaction.rollback();
      } finally {
        await connection.release();
      }

      const after = await queryRows<{ id: string }>(
        h.driver,
        'select id from items where id = 100',
      );
      expect(after).toEqual([]);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'wraps connection-scoped streaming again after a transaction settles',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 8);

      const connection = await h.driver.acquireConnection();
      const transaction = await connection.beginTransaction();
      await transaction.commit();
      h.recordedQueryTexts.length = 0;

      const rows: unknown[] = [];
      for await (const row of connection.query({ sql: 'select id from items order by id' })) {
        rows.push(row);
      }
      await connection.release();

      expect(rows).toHaveLength(8);
      expect(h.recordedQueryTexts).toEqual(['BEGIN', 'select id from items order by id', 'COMMIT']);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'serializes concurrent streams on a shared client so both complete',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 5 });
      await seedRows(h, 20);

      const consume = async (): Promise<number> => {
        let count = 0;
        for await (const _row of h.driver.query({ sql: 'select id from items order by id' })) {
          count++;
        }
        return count;
      };

      const [first, second] = await Promise.all([consume(), consume()]);
      expect(first).toBe(20);
      expect(second).toBe(20);
      expect(h.db.isInTransaction()).toBe(false);
    },
    timeouts.spinUpDbServer,
  );

  it(
    'a driver-level streamed query during an open connection transaction does not end it',
    async () => {
      const h = await createSharedSessionHarness({ cursorBatchSize: 10 });
      await seedRows(h, 5);

      const connection = await h.driver.acquireConnection();
      const tx = await connection.beginTransaction();
      try {
        await executeSql(tx, 'insert into items (id, n) values (100, 200)');

        // A driver-level read on the shared socket (the runtime's lazy
        // verify-marker read does exactly this mid-mutation). The portal
        // protection wrap must be skipped: its COMMIT would end the open
        // transaction and the rollback below would undo nothing.
        const rows = await queryRows(h.driver, 'select id from items where id = 100');
        expect(rows).toHaveLength(1);
        expect(h.recordedQueryTexts).not.toContain('COMMIT');
      } finally {
        await tx.rollback();
        await connection.release();
      }

      const after = await queryRows(h.driver, 'select id from items where id = 100');
      expect(after).toEqual([]);
    },
    timeouts.spinUpDbServer,
  );
});
