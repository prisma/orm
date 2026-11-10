import mariadbDriver from '@internal/driver-mariadb/control';
import type { MysqlControlDriver } from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import mariadbTarget from '@internal/target-mariadb/control';
import { acquireMarkerLock, releaseMarkerLock } from '@internal/target-mysql/marker-lock';
import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import mariadbAdapter from '../src/exports/control';

const SERVER = 'MARIADB_URL';

function createAdapter(): SqlControlAdapter<'mariadb'> {
  return mariadbAdapter.create(
    createControlStack({
      family: sql,
      target: mariadbTarget,
      adapter: mariadbAdapter,
      driver: mariadbDriver,
    }),
  );
}

function connect(url: string): Promise<MysqlControlDriver<'mariadb'>> {
  return mariadbDriver.create(url, { sessionSettings: mariadbTarget.sessionSettings ?? {} });
}

async function bootstrap(
  adapter: SqlControlAdapter<'mariadb'>,
  driver: MysqlControlDriver<'mariadb'>,
): Promise<void> {
  for (const node of adapter.bootstrapControlTableQueries()) {
    await driver.query((await adapter.lowerToExecuteRequest(node)).sql);
  }
}

async function lockIsFree(url: string): Promise<boolean> {
  const other = await mariadbDriver.create(url);
  try {
    await acquireMarkerLock(other, 0);
    await releaseMarkerLock(other);
    return true;
  } catch {
    return false;
  } finally {
    await other.close();
  }
}

describe('the MariaDB control adapter against a MariaDB server', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('runs its session in UTC and at READ COMMITTED through tx_isolation, which MariaDB 10.11 has instead of transaction_isolation', async (test) => {
    await withMysqlDatabase(
      test,
      async ({ url }) => {
        const driver = await connect(url);
        try {
          const { rows } = await driver.query<{ zone: string; isolation: string }>(
            'SELECT @@session.time_zone AS zone, @@session.tx_isolation AS isolation',
          );
          expect(rows).toEqual([{ zone: '+00:00', isolation: 'READ-COMMITTED' }]);
        } finally {
          await driver.close();
        }
      },
      SERVER,
    );
  });

  it('creates the control tables, reads them back, and leaves them out of introspection', async (test) => {
    await withMysqlDatabase(
      test,
      async ({ url }) => {
        const adapter = createAdapter();
        const driver = await connect(url);
        try {
          expect(await adapter.readMarker(driver, 'app')).toBeNull();
          for (const node of adapter.bootstrapControlTableQueries()) {
            const { sql: ddl } = await adapter.lowerToExecuteRequest(node);
            await driver.query(ddl);
            await driver.query(ddl);
          }
          expect(await adapter.readMarker(driver, 'app')).toBeNull();
          await driver.query(
            'INSERT INTO `_prisma_marker` (core_hash, profile_hash, invariants) VALUES (?, ?, ?)',
            ['sha256:core', 'sha256:profile', '["inv"]'],
          );
          await driver.query(
            'INSERT INTO `_prisma_ledger` (space, migration_name, migration_hash, destination_core_hash, operations) VALUES (?, ?, ?, ?, ?)',
            ['app', 'init', 'sha256:m', 'sha256:core', '[{}]'],
          );
          expect({
            marker: await adapter.readMarker(driver, 'app'),
            ledger: await adapter.readLedger(driver),
            tables: Object.keys(((await adapter.introspect(driver)) as SqlSchemaIR).tables),
          }).toMatchObject({
            marker: {
              storageHash: 'sha256:core',
              profileHash: 'sha256:profile',
              meta: {},
              invariants: ['inv'],
            },
            ledger: [{ space: 'app', migrationName: 'init', to: 'sha256:core', operationCount: 1 }],
            tables: [],
          });
        } finally {
          await driver.close();
        }
      },
      SERVER,
    );
  });

  it('introspects a table MariaDB reports with display widths and no index expressions in the form MySQL reports it', async (test) => {
    await withMysqlDatabase(
      test,
      async ({ url }) => {
        const adapter = createAdapter();
        const driver = await connect(url);
        try {
          await driver.query(
            'CREATE TABLE `T` (`id` int NOT NULL AUTO_INCREMENT, `n` bigint, PRIMARY KEY (`id`), KEY `T_n_idx` (`n`))',
          );
          const table = ((await adapter.introspect(driver)) as SqlSchemaIR).tables['T'];
          expect({
            id: table?.columns['id']?.typeText,
            n: table?.columns['n']?.typeText,
            indexes: table?.indexes.map(({ name, columns }) => ({ name, columns })),
          }).toEqual({
            id: 'int',
            n: 'bigint',
            indexes: [{ name: 'T_n_idx', columns: ['n'] }],
          });
        } finally {
          await driver.close();
        }
      },
      SERVER,
    );
  });

  it('writes markers and ledger entries, upserting a marker without a row alias, and advances a marker only from the hash it holds', async (test) => {
    await withMysqlDatabase(
      test,
      async ({ url }) => {
        const adapter = createAdapter();
        const driver = await connect(url);
        try {
          await bootstrap(adapter, driver);
          await adapter.insertMarker(driver, 'ext', { storageHash: 'sha256:e1', profileHash: 'p' });
          await expect(
            adapter.insertMarker(driver, 'ext', { storageHash: 'sha256:e2', profileHash: 'p' }),
          ).rejects.toThrow();
          await adapter.initMarker(driver, 'app', { storageHash: 'sha256:a1', profileHash: 'p1' });
          await adapter.initMarker(driver, 'app', {
            storageHash: 'sha256:a2',
            profileHash: 'p2',
            invariants: ['inv-1'],
          });
          const swaps = await adapter.withTransaction(driver, async () => [
            await adapter.updateMarker(driver, 'app', 'sha256:stale', {
              storageHash: 'sha256:x',
              profileHash: 'px',
            }),
            await adapter.updateMarker(driver, 'app', 'sha256:a2', {
              storageHash: 'sha256:a3',
              profileHash: 'p3',
              invariants: ['inv-0'],
            }),
          ]);
          await adapter.writeLedgerEntry(driver, 'app', {
            edgeId: 'sha256:a2->sha256:a3',
            from: 'sha256:a2',
            to: 'sha256:a3',
            migrationName: '20261022_add',
            migrationHash: 'sha256:m',
            operations: [{ id: 'one' }],
          });

          const markers = await adapter.readAllMarkers(driver);
          expect({
            swaps,
            app: markers.get('app'),
            ext: markers.get('ext')?.storageHash,
            ledger: await adapter.readLedger(driver, 'app'),
          }).toMatchObject({
            swaps: [false, true],
            app: { storageHash: 'sha256:a3', profileHash: 'p3', invariants: ['inv-0', 'inv-1'] },
            ext: 'sha256:e1',
            ledger: [
              { space: 'app', migrationName: '20261022_add', from: 'sha256:a2', to: 'sha256:a3' },
            ],
          });
        } finally {
          await driver.close();
        }
      },
      SERVER,
    );
  });

  it('commits and rolls back on one connection', async (test) => {
    await withMysqlDatabase(
      test,
      async ({ url }) => {
        const adapter = createAdapter();
        const driver = await connect(url);
        try {
          await driver.query('CREATE TABLE t (id INT PRIMARY KEY)');
          await adapter.withTransaction(driver, () => driver.query('INSERT INTO t VALUES (1)'));
          await expect(
            adapter.withTransaction(driver, async () => {
              await driver.query('INSERT INTO t VALUES (2)');
              throw new Error('undo');
            }),
          ).rejects.toThrow('undo');
          expect((await driver.query('SELECT id FROM t')).rows).toEqual([{ id: '1' }]);
        } finally {
          await driver.close();
        }
      },
      SERVER,
    );
  });

  it('releases the marker lock when the transaction it guards commits or rolls back', async (test) => {
    await withMysqlDatabase(
      test,
      async ({ url }) => {
        const adapter = createAdapter();
        const driver = await connect(url);
        try {
          if (adapter.holdMarkerLock === undefined) throw new Error('no holdMarkerLock');
          const heldDuringCommit = await adapter.holdMarkerLock(driver, () =>
            adapter.withTransaction(driver, async () => !(await lockIsFree(url))),
          );
          const freeAfterCommit = await lockIsFree(url);
          expect({ heldDuringCommit, freeAfterCommit }).toEqual({
            heldDuringCommit: true,
            freeAfterCommit: true,
          });
        } finally {
          await driver.close();
        }
      },
      SERVER,
    );
  });
});
