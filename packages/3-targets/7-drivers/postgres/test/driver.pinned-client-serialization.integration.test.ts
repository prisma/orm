/**
 * pg@8 silently queues a query sent while another is in flight on the same
 * Client (emitting a DeprecationWarning); pg@9 throws instead. The driver owns
 * FIFO serialization per physical client, so overlapping calls on any pinned
 * client never reach pg while a query is in flight.
 */

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { timeouts } from '@repo/test-utils';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { executeSql, queryRows } from './sql-queryable-test-utils';

interface Harness {
  readonly client: Client;
  readonly driver: ReturnType<typeof postgresRuntimeDriverDescriptor.create>;
  readonly recordedQueryTexts: string[];
  maxInFlight(): number;
  close(): Promise<void>;
}

let cleanup: (() => Promise<void>) | undefined;

function installConcurrencySpy(client: Client): { texts: string[]; maxInFlight(): number } {
  const texts: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const original = client.query.bind(client);
  const spied = (...args: unknown[]): unknown => {
    const first = args[0];
    if (typeof first === 'string') {
      texts.push(first);
    } else if (
      typeof first === 'object' &&
      first !== null &&
      'text' in first &&
      typeof (first as { text?: unknown }).text === 'string'
    ) {
      texts.push((first as { text: string }).text);
    }
    const result = (original as (...inner: unknown[]) => unknown)(...args);
    if (result instanceof Promise) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return result.finally(() => {
        inFlight--;
      });
    }
    return result;
  };
  (client as unknown as { query: typeof spied }).query = spied;
  return { texts, maxInFlight: () => maxInFlight };
}

async function createHarness(options?: { readonly cursorBatchSize?: number }): Promise<Harness> {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  let client: Client | undefined;
  let driver: ReturnType<typeof postgresRuntimeDriverDescriptor.create> | undefined;
  // Registered before any fallible step so afterEach tears down whatever
  // exists when setup rejects mid-way. Ending the client after driver.close()
  // is a no-op-safe double-end on the happy path (a connected pgClient
  // binding already ends it) but covers a client the driver never adopted.
  const close = async (): Promise<void> => {
    await driver?.close().catch(() => {});
    await client?.end().catch(() => {});
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
  };
  cleanup = close;

  await server.start();
  const serverConn = server.getServerConn();
  const port = Number(serverConn.slice(serverConn.lastIndexOf(':') + 1));

  client = new Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres' });
  client.on('error', () => {});
  await client.connect();
  const spy = installConcurrencySpy(client);

  driver = postgresRuntimeDriverDescriptor.create({
    cursor: { batchSize: options?.cursorBatchSize ?? 10 },
  });
  await driver.connect({ kind: 'pgClient', client });

  return {
    client,
    driver,
    recordedQueryTexts: spy.texts,
    maxInFlight: spy.maxInFlight,
    close,
  };
}

function captureProcessWarnings(): { readonly warnings: Error[]; stop(): void } {
  const warnings: Error[] = [];
  const handler = (warning: Error): void => {
    if (
      warning.name === 'DeprecationWarning' &&
      warning.message.toLowerCase().includes('already executing a query')
    ) {
      warnings.push(warning);
    }
  };
  process.on('warning', handler);
  return {
    warnings,
    stop: () => {
      process.removeListener('warning', handler);
    },
  };
}

async function settleWarnings(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function seedRows(h: Harness, count: number): Promise<void> {
  await executeSql(h.driver, 'create table items (id int primary key, n int not null)');
  const values = Array.from({ length: count }, (_, i) => `(${i}, ${i * 2})`).join(', ');
  await executeSql(h.driver, `insert into items (id, n) values ${values}`);
}

afterEach(async () => {
  if (cleanup) {
    await cleanup();
    cleanup = undefined;
  }
}, timeouts.spinUpDbServer);

describe('pinned-client serialization on a real wire', () => {
  // pg wraps its overlap warning in util.deprecate, which fires once per
  // process — so exactly one test owns the warning capture, and its warning
  // assertion runs first.
  it(
    '3-way query overlap on a pinned client emits no pg DeprecationWarning',
    async () => {
      const h = await createHarness();
      const capture = captureProcessWarnings();
      try {
        const results = await Promise.all([
          queryRows<{ n: string }>(h.driver, 'select 1 as n'),
          queryRows<{ n: string }>(h.driver, 'select 2 as n'),
          queryRows<{ n: string }>(h.driver, 'select 3 as n'),
        ]);
        await settleWarnings();

        expect(capture.warnings).toEqual([]);
        expect(results.map((r) => r[0])).toEqual([{ n: '1' }, { n: '2' }, { n: '3' }]);
      } finally {
        capture.stop();
      }
    },
    timeouts.spinUpDbServer,
  );

  it(
    '3-way query overlap on a direct driver stays sequential',
    async () => {
      const h = await createHarness();
      const results = await Promise.all([
        queryRows<{ n: string }>(h.driver, 'select 1 as n'),
        queryRows<{ n: string }>(h.driver, 'select 2 as n'),
        queryRows<{ n: string }>(h.driver, 'select 3 as n'),
      ]);

      expect(results.map((r) => r[0])).toEqual([{ n: '1' }, { n: '2' }, { n: '3' }]);
      expect(h.maxInFlight()).toBe(1);
    },
    timeouts.spinUpDbServer,
  );

  it(
    '3-way query overlap on a pinned connection stays sequential',
    async () => {
      const h = await createHarness();
      const connection = await h.driver.acquireConnection();
      try {
        const results = await Promise.all([
          queryRows<{ n: string }>(connection, 'select 1 as n'),
          queryRows<{ n: string }>(connection, 'select 2 as n'),
          queryRows<{ n: string }>(connection, 'select 3 as n'),
        ]);

        expect(results.map((r) => r[0])).toEqual([{ n: '1' }, { n: '2' }, { n: '3' }]);
        expect(h.maxInFlight()).toBe(1);
      } finally {
        await connection.release();
      }
    },
    timeouts.spinUpDbServer,
  );

  it(
    '3-way query overlap on a transaction handle stays sequential',
    async () => {
      const h = await createHarness();
      const connection = await h.driver.acquireConnection();
      try {
        const transaction = await connection.beginTransaction();
        const results = await Promise.all([
          queryRows<{ n: string }>(transaction, 'select 1 as n'),
          queryRows<{ n: string }>(transaction, 'select 2 as n'),
          queryRows<{ n: string }>(transaction, 'select 3 as n'),
        ]);
        await transaction.commit();

        expect(results.map((r) => r[0])).toEqual([{ n: '1' }, { n: '2' }, { n: '3' }]);
        expect(h.maxInFlight()).toBe(1);
      } finally {
        await connection.release();
      }
    },
    timeouts.spinUpDbServer,
  );

  it(
    'a stream and a concurrent query on one pinned client do not interleave transaction boundaries',
    async () => {
      const h = await createHarness({ cursorBatchSize: 5 });
      await seedRows(h, 20);
      h.recordedQueryTexts.length = 0;

      const streamed: string[] = [];
      const consumeStream = async (): Promise<void> => {
        for await (const row of h.driver.query<{ id: string }>({
          sql: 'select id from items order by id',
        })) {
          streamed.push(row.id);
        }
      };

      const [, other] = await Promise.all([
        consumeStream(),
        queryRows<{ n: string }>(h.driver, 'select count(*)::int as n from items'),
      ]);

      expect(streamed).toHaveLength(20);
      expect(other).toEqual([{ n: '20' }]);

      const begin = h.recordedQueryTexts.indexOf('BEGIN');
      const commit = h.recordedQueryTexts.indexOf('COMMIT');
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(commit).toBeGreaterThan(begin);
      expect(h.recordedQueryTexts.slice(begin + 1, commit)).toEqual([
        'select id from items order by id',
      ]);
    },
    timeouts.spinUpDbServer,
  );
});
