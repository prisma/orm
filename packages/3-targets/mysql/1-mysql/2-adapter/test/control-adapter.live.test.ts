import mysqlDriver, { type MysqlControlDriver } from '@internal/driver-mysql/control';
import { acquireMarkerLock, releaseMarkerLock } from '@internal/target-mysql/marker-lock';
import mysqlTarget from '@internal/target-mysql/runtime';
import { ifDefined } from '@internal/utils/defined';
import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import { createAdapter } from './helpers';

async function bootstrap(driver: MysqlControlDriver): Promise<void> {
  const adapter = createAdapter();
  for (const node of adapter.bootstrapControlTableQueries()) {
    await driver.query((await adapter.lowerToExecuteRequest(node)).sql);
  }
}

async function lockIsFree(url: string): Promise<boolean> {
  const other = await mysqlDriver.create(url);
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

describe('MysqlControlAdapter against a MySQL server', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('creates the control tables, reads them back, and leaves them out of introspection', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const adapter = createAdapter();
      const driver = await mysqlDriver.create(url);
      try {
        expect(await adapter.readMarker(driver, 'app')).toBeNull();
        for (const node of adapter.bootstrapControlTableQueries()) {
          const { sql } = await adapter.lowerToExecuteRequest(node);
          await driver.query(sql);
          await driver.query(sql);
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
        expect(await adapter.readMarker(driver, 'app')).toMatchObject({
          storageHash: 'sha256:core',
          profileHash: 'sha256:profile',
          meta: {},
          invariants: ['inv'],
        });
        expect(await adapter.readLedger(driver)).toMatchObject([
          { space: 'app', migrationName: 'init', to: 'sha256:core', operationCount: 1 },
        ]);
        expect(Object.keys((await adapter.introspect(driver)).tables)).toEqual([]);
      } finally {
        await driver.close();
      }
    });
  });

  it('stamps control-table rows with the current time in UTC, in a session with the settings the target declares', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const adapter = createAdapter();
      const driver = await mysqlDriver.create(url, {
        ...ifDefined('sessionSettings', mysqlTarget.sessionSettings),
      });
      try {
        for (const node of adapter.bootstrapControlTableQueries()) {
          await driver.query((await adapter.lowerToExecuteRequest(node)).sql);
        }
        const before = Date.now() - 1000;
        await driver.query('INSERT INTO `_prisma_marker` (core_hash, profile_hash) VALUES (?, ?)', [
          'sha256:core',
          'sha256:profile',
        ]);
        await driver.query(
          'INSERT INTO `_prisma_ledger` (space, migration_name, migration_hash, destination_core_hash, operations) VALUES (?, ?, ?, ?, ?)',
          ['app', 'init', 'sha256:m', 'sha256:core', '[]'],
        );
        const after = Date.now() + 1000;
        const updatedAt = (await adapter.readMarker(driver, 'app'))?.updatedAt.getTime() ?? 0;
        const appliedAt = (await adapter.readLedger(driver))[0]?.appliedAt.getTime() ?? 0;
        const within = (time: number) => time >= before && time <= after;
        expect({ marker: within(updatedAt), ledger: within(appliedAt) }).toEqual({
          marker: true,
          ledger: true,
        });
      } finally {
        await driver.close();
      }
    });
  });

  it('names the database a foreign key into another database references', async (test) => {
    await withMysqlDatabase(test, async ({ url, name }) => {
      const adapter = createAdapter();
      const driver = await mysqlDriver.create(url);
      const other = `${name}_other`;
      try {
        await driver.query(`CREATE DATABASE \`${other}\``);
        await driver.query(`CREATE TABLE \`${other}\`.\`User\` (id INT PRIMARY KEY)`);
        await driver.query(
          `CREATE TABLE Post (id INT PRIMARY KEY, authorId INT NOT NULL, CONSTRAINT Post_authorId_fkey FOREIGN KEY (authorId) REFERENCES \`${other}\`.\`User\` (id))`,
        );
        const post = (await adapter.introspect(driver)).tables['Post'];
        expect(
          post?.foreignKeys.map(({ referencedSchema, referencedTable }) => ({
            referencedSchema,
            referencedTable,
          })),
        ).toEqual([{ referencedSchema: other, referencedTable: 'User' }]);
      } finally {
        try {
          await driver.query('DROP TABLE IF EXISTS Post');
        } finally {
          try {
            await driver.query(`DROP DATABASE IF EXISTS \`${other}\``);
          } finally {
            await driver.close();
          }
        }
      }
    });
  });

  it('commits and rolls back on one connection', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const adapter = createAdapter();
      const driver = await mysqlDriver.create(url);
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
    });
  });
  it('writes markers and ledger entries, and advances a marker only from the hash it holds', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const adapter = createAdapter();
      const driver = await mysqlDriver.create(url);
      try {
        await bootstrap(driver);
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
    });
  });

  it('releases the marker lock when the transaction it guards commits or rolls back', async (test) => {
    await withMysqlDatabase(test, async ({ url }) => {
      const adapter = createAdapter();
      const driver = await mysqlDriver.create(url);
      try {
        const heldDuringCommit = await adapter.holdMarkerLock(driver, () =>
          adapter.withTransaction(driver, async () => !(await lockIsFree(url))),
        );
        const freeAfterCommit = await lockIsFree(url);
        let heldDuringRollback = false;
        await expect(
          adapter.holdMarkerLock(driver, () =>
            adapter.withTransaction(driver, async () => {
              heldDuringRollback = !(await lockIsFree(url));
              throw new Error('undo');
            }),
          ),
        ).rejects.toThrow('undo');
        expect({
          heldDuringCommit,
          freeAfterCommit,
          heldDuringRollback,
          freeAfterRollback: await lockIsFree(url),
        }).toEqual({
          heldDuringCommit: true,
          freeAfterCommit: true,
          heldDuringRollback: true,
          freeAfterRollback: true,
        });
      } finally {
        await driver.close();
      }
    });
  });
});
