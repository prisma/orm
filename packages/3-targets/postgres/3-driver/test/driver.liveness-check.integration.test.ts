import { SqlConnectionError } from '@internal/sql-errors';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import {
  type Death,
  type DyingConnectionsProxy,
  startDyingConnectionsProxy,
  targetOf,
  throughProxy,
} from './dying-connections-proxy';
import {
  idleBeyondThreshold,
  useLoweredLivenessCheck,
  useShippedIdleThreshold,
} from './lowered-liveness-check';
import { executeSql, queryRows } from './sql-queryable-test-utils';

useLoweredLivenessCheck();

let proxy: DyingConnectionsProxy;
let closeDatabase: () => Promise<void>;
let connectionString: string;
const cleanups: (() => Promise<void>)[] = [];

beforeEach(async () => {
  const database = await createDevDatabase();
  closeDatabase = () => database.close();
  proxy = await startDyingConnectionsProxy(targetOf(database.connectionString));
  connectionString = throughProxy(database.connectionString, proxy.port);
}, timeouts.spinUpPpgDev);

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
  await proxy.close();
  await closeDatabase();
}, timeouts.spinUpPpgDev);

function poolOfOne(sessionSettings?: Record<string, string>) {
  const driver = createBoundDriverFromBinding(
    { kind: 'pgPool', pool: new pg.Pool({ connectionString, max: 1 }), ownedByDriver: true },
    { disabled: true },
    sessionSettings === undefined ? undefined : { sessionSettings },
  );
  cleanups.push(() => driver.close());
  return driver;
}

describe('a pooled connection that died while idle', () => {
  it.each<Death>(['reset', 'fatal', 'silence'])(
    'is replaced before a read on a pool of one after %s',
    async (death) => {
      const driver = poolOfOne();
      await queryRows(driver, "select 'warm'");
      proxy.connectionThatRan("select 'warm'").die(death);
      await idleBeyondThreshold();

      expect(await queryRows(driver, 'select 1 as one')).toEqual([{ one: '1' }]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'is replaced before a statement that returns no rows, which reaches the server once',
    async () => {
      const driver = poolOfOne();
      await executeSql(driver, 'create table liveness_rows (id int)');
      proxy.connectionThatRan('create table liveness_rows (id int)').die('reset');
      await idleBeyondThreshold();

      expect(await executeSql(driver, 'insert into liveness_rows values (1)')).toEqual({
        affectedRows: 1,
      });
      expect(proxy.statements().filter((statement) => statement.startsWith('insert into'))).toEqual(
        ['insert into liveness_rows values (1)'],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'is replaced before a transaction',
    async () => {
      const driver = poolOfOne();
      await queryRows(driver, "select 'warm'");
      proxy.connectionThatRan("select 'warm'").die('reset');
      await idleBeyondThreshold();

      const connection = await driver.acquireConnection();
      try {
        const transaction = await connection.beginTransaction();
        expect(await queryRows(transaction, 'select 1 as one')).toEqual([{ one: '1' }]);
        await transaction.commit();
      } finally {
        await connection.release();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it.each<Death>(['reset', 'silence'])(
    'is replaced after %s when the session settings are due, which serve as its liveness check',
    async (death) => {
      const driver = poolOfOne({ DateStyle: 'ISO, YMD' });
      await queryRows(driver, "select 'warm'");
      await (await driver.acquireConnection()).release();
      proxy.connectionThatRan("select 'warm'").die(death);
      await idleBeyondThreshold();

      expect(await queryRows(driver, 'select 1 as one')).toEqual([{ one: '1' }]);

      await (await driver.acquireConnection()).release();
      const live = proxy.connectionThatRan('select 1 as one');
      const sentBefore = live.statements.length;
      await idleBeyondThreshold();
      await queryRows(driver, 'select 2 as two');

      expect(live.statements.slice(sentBefore)).toEqual([
        expect.stringMatching(/^SELECT set_config\(/),
        'select 2 as two',
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'gives the connect error when the database is gone',
    async () => {
      const driver = poolOfOne();
      await queryRows(driver, "select 'warm'");
      proxy.connectionThatRan("select 'warm'").die('reset');
      proxy.refuseConnections();
      await idleBeyondThreshold();

      const error = await queryRows(driver, 'select 1').then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(SqlConnectionError);
      expect(error).toHaveProperty('cause.code', 'ECONNREFUSED');
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'lets close() settle while its liveness check is pending, and the pending caller gets a connection error',
    async () => {
      const driver = poolOfOne();
      await queryRows(driver, "select 'warm'");
      const dying = proxy.connectionThatRan("select 'warm'");
      dying.die('silence');
      await idleBeyondThreshold();

      const outcome = queryRows(driver, 'select 1').then(
        () => 'resolved',
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(dying.wroteAfterDeath).toBe(true), {
        timeout: timeouts.databaseOperation,
      });
      await driver.close();

      expect(await outcome).toBeInstanceOf(SqlConnectionError);
    },
    timeouts.spinUpPpgDev,
  );
});

describe('a pooled connection used within the threshold', () => {
  it(
    'is used unchecked, so the server receives the caller statement and nothing before it',
    async () => {
      useShippedIdleThreshold();
      const driver = poolOfOne();
      await queryRows(driver, "select 'warm'");
      await queryRows(driver, 'select 2 as two');

      expect(proxy.connectionThatRan("select 'warm'").statements).toEqual([
        "select 'warm'",
        'select 2 as two',
      ]);
    },
    timeouts.spinUpPpgDev,
  );
});
