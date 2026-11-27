import { setTimeout as sleep } from 'node:timers/promises';
import { timeouts } from '@repo/test-utils';
import { inCi } from '@repo/test-utils/ci';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { livenessCheckSettings } from '../src/liveness-check';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import {
  type Death,
  type DyingConnectionsProxy,
  startDyingConnectionsProxy,
  targetOf,
  throughProxy,
} from './dying-connections-proxy';
import { queryRows } from './sql-queryable-test-utils';

const IDLE_THRESHOLD_MILLIS = 30;
const CHECK_LIMIT_MILLIS = 300;
const original = { ...livenessCheckSettings };

const serverUrl =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/postgres';

async function answers(url: string): Promise<boolean> {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: timeouts.databaseOperation,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const realPostgresAvailable = await answers(serverUrl);

it.runIf(inCi)(
  'has the PostgreSQL server its liveness check tests run against when it runs in CI',
  () => {
    expect(
      realPostgresAvailable,
      'No PostgreSQL server answers at DATABASE_URL, or at localhost:5432 when it is unset, so the liveness check tests skipped',
    ).toBe(true);
  },
);

function idleBeyondThreshold(): Promise<void> {
  return sleep(IDLE_THRESHOLD_MILLIS * 2);
}

/**
 * The dev database accepts one connection at a time, so these cases, which hold several pooled
 * connections at once, run against a real server.
 */
describe.runIf(realPostgresAvailable)('pooled connections that died while idle', () => {
  let proxy: DyingConnectionsProxy;
  const cleanups: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    Object.assign(livenessCheckSettings, {
      checkAfterIdleMillis: IDLE_THRESHOLD_MILLIS,
      timeoutMillis: CHECK_LIMIT_MILLIS,
    });
    proxy = await startDyingConnectionsProxy(targetOf(serverUrl));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    Object.assign(livenessCheckSettings, original);
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
    await proxy.close();
  }, timeouts.spinUpPpgDev);

  function poolWithDriver(max: number) {
    const pool = new pg.Pool({ connectionString: throughProxy(serverUrl, proxy.port), max });
    const removed: unknown[] = [];
    pool.on('remove', (client) => removed.push(client));
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool, ownedByDriver: true },
      { disabled: true },
    );
    cleanups.push(() => driver.close());
    return { pool, driver, removed };
  }

  /** Leaves one idle client in `pool` per label, the last label's the most recently released. */
  async function leaveIdle(pool: pg.Pool, labels: readonly string[]): Promise<void> {
    const clients: pg.PoolClient[] = [];
    for (const label of labels) {
      const client = await pool.connect();
      await client.query(`select '${label}'`);
      clients.push(client);
    }
    for (const client of clients) client.release();
  }

  async function threeDeadClients(death: Death) {
    const setUp = poolWithDriver(3);
    await leaveIdle(setUp.pool, ['a', 'b', 'c']);
    for (const connection of proxy.connections) connection.die(death);
    await idleBeyondThreshold();
    return setUp;
  }

  it(
    'serves a read on a pool of three dead clients with one check and two evictions',
    async () => {
      const { driver, removed } = await threeDeadClients('reset');

      expect(await queryRows(driver, 'select 1 as one')).toEqual([{ one: '1' }]);
      expect(proxy.connections.filter((connection) => connection.wroteAfterDeath)).toHaveLength(1);
      expect(proxy.connections).toHaveLength(4);
      await vi.waitFor(() => expect(removed).toHaveLength(3));
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'pays one check limit for three silent clients, and closes every socket to them',
    async () => {
      const { driver, removed } = await threeDeadClients('silence');

      expect(await queryRows(driver, 'select 1 as one')).toEqual([{ one: '1' }]);
      await vi.waitFor(() => expect(removed).toHaveLength(3), {
        timeout: CHECK_LIMIT_MILLIS * 3,
      });
      expect(proxy.connections.filter((connection) => connection.wroteAfterDeath)).toHaveLength(1);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'serves three simultaneous reads on three dead clients',
    async () => {
      const { driver } = await threeDeadClients('reset');

      expect(
        await Promise.all([1, 2, 3].map((n) => queryRows(driver, `select ${n} as n`))),
      ).toEqual([[{ n: '1' }], [{ n: '2' }], [{ n: '3' }]]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'keeps a client used and released while another client’s silent check was pending',
    async () => {
      const { pool, driver, removed } = poolWithDriver(2);
      await leaveIdle(pool, ['a', 'b']);
      const silent = proxy.connectionThatRan("select 'b'");
      silent.die('silence');
      await idleBeyondThreshold();

      const waiting = queryRows(driver, "select 'first'");
      await vi.waitFor(() => expect(silent.wroteAfterDeath).toBe(true));
      await queryRows(driver, "select 'second'");
      await waiting;

      expect(removed).toHaveLength(1);
      expect(proxy.connections).toHaveLength(2);
      const statementsOnA = proxy.connectionThatRan("select 'a'").statements;
      expect(statementsOnA.filter((statement) => statement !== '')).toEqual([
        "select 'a'",
        "select 'second'",
        "select 'first'",
      ]);
    },
    timeouts.spinUpPpgDev,
  );
});
