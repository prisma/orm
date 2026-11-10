import type { Contract } from '@internal/contract/types';
import type { MysqlControlDriver } from '@internal/driver-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql, {
  createMigrationPlan,
  type SqlControlFamilyInstance,
} from '@internal/family-sql/control';
import type { MigrationPlan, MigrationRunnerResult } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import mysql, { type MysqlPlanTargetDetails } from '@internal/target-mysql/control';
import { acquireMarkerLock, releaseMarkerLock } from '@internal/target-mysql/marker-lock';
import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';
import { exampleTablesDdl, frameworkComponents, loadExampleContract } from '../example-contract';
import {
  contractRepointedToAdmin,
  contractWithNickname,
  contractWithoutForeignKey,
  contractWithUnindexedForeignKey,
} from './contracts';
import { controlStack, createAdapter, EVERY_CLASS, operationSql } from './planner-harness';

/** A plan for `contract` whose one operation fails when it runs, before it changes anything. */
function failingPlan(contract: Contract<SqlStorage>): MigrationPlan {
  return createMigrationPlan<MysqlPlanTargetDetails>({
    targetId: 'mysql',
    spaceId: 'app',
    origin: null,
    destination: { storageHash: contract.storage.storageHash },
    operations: [
      {
        id: 'table.Post',
        label: 'Create table Post',
        operationClass: 'additive',
        target: { id: 'mysql', details: { objectType: 'table', name: 'Post' } },
        precheck: [],
        execute: [
          { description: 'read a table that does not exist', sql: 'SELECT * FROM `missing`' },
        ],
        postcheck: [{ description: 'never holds', sql: 'SELECT 0' }],
      },
    ],
    providedInvariants: [],
  });
}

function auditContract() {
  return defineContract({}, ({ field, model, type }) => ({
    models: {
      AuditLog: model('AuditLog', {
        fields: { id: field.column(type.Int()).id(), action: field.column(type.String()) },
      }),
    },
  }));
}

async function withDriver<T>(
  url: string,
  fn: (driver: MysqlControlDriver, family: SqlControlFamilyInstance) => Promise<T>,
): Promise<T> {
  const driver = await mysqlDriver.create(url);
  try {
    return await fn(driver, sql.create(controlStack));
  } finally {
    await driver.close();
  }
}

async function planResult(
  driver: MysqlControlDriver,
  family: SqlControlFamilyInstance,
  space: string,
  contract: Contract<SqlStorage>,
) {
  return mysql.migrations.createPlanner(createAdapter()).plan({
    contract,
    schema: await family.introspect({ driver }),
    policy: EVERY_CLASS,
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents,
    spaceId: space,
    snapshotsImportPath: '../../snapshots',
  });
}

async function planAgainst(
  driver: MysqlControlDriver,
  family: SqlControlFamilyInstance,
  space: string,
  contract: Contract<SqlStorage>,
) {
  const result = await planResult(driver, family, space, contract);
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result.plan;
}

async function indexNames(driver: MysqlControlDriver, table: string): Promise<readonly string[]> {
  const { rows } = await driver.query<{ INDEX_NAME: string }>(
    'SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME',
    [table],
  );
  return rows.map((row) => row.INDEX_NAME);
}

function spaceOptions(
  driver: MysqlControlDriver,
  space: string,
  plan: MigrationPlan,
  contract: Contract<SqlStorage>,
) {
  return {
    space,
    plan,
    driver,
    destinationContract: contract,
    policy: EVERY_CLASS,
    frameworkComponents,
    strictVerification: false,
    migrationEdges: [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: undefined,
        destinationStorageHash: plan.destination.storageHash,
        operationCount: plan.operations.length,
      }),
    ],
  };
}

function apply(
  family: SqlControlFamilyInstance,
  driver: MysqlControlDriver,
  spaces: readonly (readonly [string, MigrationPlan, Contract<SqlStorage>])[],
): Promise<MigrationRunnerResult> {
  return mysql.migrations.createRunner(family).execute({
    driver,
    perSpaceOptions: spaces.map(([space, plan, contract]) =>
      spaceOptions(driver, space, plan, contract),
    ),
  });
}

async function markerHashes(family: SqlControlFamilyInstance, driver: MysqlControlDriver) {
  const markers = await family.readAllMarkers({ driver });
  return Object.fromEntries([...markers].map(([space, marker]) => [space, marker.storageHash]));
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

describe('migrating a MySQL database', { timeout: timeouts.databaseOperation }, () => {
  it('applies the example contract, which then verifies and signs', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        const contract = loadExampleContract();
        const plan = await planAgainst(driver, family, 'app', contract);
        const applied = await apply(family, driver, [['app', plan, contract]]);

        const verified = family.verifySchema({
          contract,
          schema: await family.introspect({ driver, contract }),
          strict: true,
          frameworkComponents,
        });
        const signed = await family.signSpaces({
          driver,
          spaces: [
            {
              space: 'app',
              contract,
              expected: {
                storageHash: contract.storage.storageHash,
                profileHash: contract.profileHash ?? contract.storage.storageHash,
              },
            },
          ],
        });
        expect({
          applied: applied.ok,
          verified: verified.ok,
          markers: await markerHashes(family, driver),
          signed: signed.map(({ status }) => status),
          lockFree: await lockIsFree(url),
        }).toEqual({
          applied: true,
          verified: true,
          markers: { app: contract.storage.storageHash },
          signed: ['unchanged'],
          lockFree: true,
        });
      }),
    );
  });

  it('signs a database made by hand, creating the marker table first', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        for (const statement of exampleTablesDdl) await driver.query(statement);
        const contract = loadExampleContract();
        const signed = await family.signSpaces({
          driver,
          spaces: [{ space: 'app', contract, expected: null }],
        });
        expect({
          signed: signed.map(({ status }) => status),
          markers: await markerHashes(family, driver),
          lockFree: await lockIsFree(url),
        }).toEqual({
          signed: ['created'],
          markers: { app: contract.storage.storageHash },
          lockFree: true,
        });
      }),
    );
  });

  it('adds a nullable column and drops it again', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        const base = loadExampleContract();
        const withNickname = contractWithNickname();
        const steps = [base, withNickname, base];
        const planned: { id: string; sql: string[] }[][] = [];
        for (const contract of steps) {
          const plan = await planAgainst(driver, family, 'app', contract);
          planned.push(await operationSql(plan));
          const applied = await apply(family, driver, [['app', plan, contract]]);
          if (!applied.ok) throw applied.failure;
        }
        const columns = await driver.query<{ COLUMN_NAME: string }>(
          "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' ORDER BY COLUMN_NAME",
        );
        expect({
          added: planned[1],
          dropped: planned[2],
          columns: columns.rows.map((row) => row.COLUMN_NAME),
        }).toEqual({
          added: [
            {
              id: 'column.User.nickname',
              sql: ['ALTER TABLE `User` ADD COLUMN `nickname` varchar(191)'],
            },
          ],
          dropped: [
            {
              id: 'dropColumn.User.nickname',
              sql: ['ALTER TABLE `User` DROP COLUMN `nickname`'],
            },
          ],
          columns: ['email', 'id', 'role'],
        });
      }),
    );
  });

  it('drops the index InnoDB made for a foreign key when the key goes and its column stays', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        const planned: { id: string; sql: string[] }[][] = [];
        for (const contract of [contractWithUnindexedForeignKey(), contractWithoutForeignKey()]) {
          const plan = await planAgainst(driver, family, 'app', contract);
          planned.push(await operationSql(plan));
          const applied = await apply(family, driver, [['app', plan, contract]]);
          if (!applied.ok) throw applied.failure;
        }
        const withoutForeignKey = contractWithoutForeignKey();
        const verified = family.verifySchema({
          contract: withoutForeignKey,
          schema: await family.introspect({ driver, contract: withoutForeignKey }),
          strict: true,
          frameworkComponents,
        });
        expect({
          dropped: planned[1],
          verified: verified.ok,
          postIndexes: await indexNames(driver, 'Post'),
        }).toEqual({
          dropped: [
            {
              id: 'dropForeignKey.Post.Post_authorId_fkey',
              sql: ['ALTER TABLE `Post` DROP FOREIGN KEY `Post_authorId_fkey`'],
            },
            {
              id: 'dropIndex.Post.Post_authorId_fkey',
              sql: ['DROP INDEX `Post_authorId_fkey` ON `Post`'],
            },
          ],
          verified: true,
          postIndexes: ['PRIMARY'],
        });
      }),
    );
  });

  it('re-points a relation on a column with no index, and the database then verifies strictly', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        const planned: { id: string; sql: string[] }[][] = [];
        for (const contract of [contractWithUnindexedForeignKey(), contractRepointedToAdmin()]) {
          const plan = await planAgainst(driver, family, 'app', contract);
          planned.push(await operationSql(plan));
          const applied = await apply(family, driver, [['app', plan, contract]]);
          if (!applied.ok) throw applied.failure;
        }
        const repointed = contractRepointedToAdmin();
        const verified = family.verifySchema({
          contract: repointed,
          schema: await family.introspect({ driver, contract: repointed }),
          strict: true,
          frameworkComponents,
        });
        expect({
          order: planned[1]?.map(({ id }) => id),
          verified: verified.ok,
        }).toEqual({
          order: [
            'dropForeignKey.Post.Post_authorId_fkey',
            'dropIndex.Post.Post_authorId_fkey',
            'table.Admin',
            'foreignKey.Post.Post_authorId_fkey',
          ],
          verified: true,
        });
      }),
    );
  });

  it('refuses to drop the index a kept foreign key uses, before it changes anything', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        const contract = loadExampleContract();
        const applied = await apply(family, driver, [
          ['app', await planAgainst(driver, family, 'app', contract), contract],
        ]);
        if (!applied.ok) throw applied.failure;
        const before = await indexNames(driver, 'Post');
        const refused = await planResult(driver, family, 'app', contractWithUnindexedForeignKey());
        expect({
          conflicts:
            refused.kind === 'failure' ? refused.conflicts.map(({ summary }) => summary) : [],
          unchanged: (await indexNames(driver, 'Post')).join() === before.join(),
        }).toEqual({
          conflicts: [
            `Dropping index ${before.find((name) => name.startsWith('Post_authorId_idx'))}, which foreign key Post_authorId_fkey uses, is not yet supported on MySQL (Post)`,
          ],
          unchanged: true,
        });
      }),
    );
  });

  it('leaves the spaces before a failed one applied, and finishes on a second run', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        const audit = auditContract();
        const app = loadExampleContract();
        const auditPlan = await planAgainst(driver, family, 'audit', audit);
        const appPlan = await planAgainst(driver, family, 'app', app);

        const failed = await apply(family, driver, [
          ['audit', auditPlan, audit],
          ['app', failingPlan(app), app],
        ]);
        const afterFailure = await markerHashes(family, driver);
        const lockFreeAfterFailure = await lockIsFree(url);

        const rerun = await apply(family, driver, [
          ['audit', auditPlan, audit],
          ['app', appPlan, app],
        ]);

        expect({
          failure: failed.ok
            ? undefined
            : {
                code: failed.failure.code,
                failingSpace: failed.failure.meta.failingSpace,
                databaseUnchanged: failed.failure.meta.databaseUnchanged,
              },
          afterFailure,
          lockFreeAfterFailure,
          rerun: rerun.ok
            ? rerun.value.perSpaceResults.map(({ space, value }) => [
                space,
                value.operationsExecuted,
              ])
            : rerun.failure,
          afterRerun: await markerHashes(family, driver),
        }).toEqual({
          failure: {
            code: 'MIGRATION.EXECUTION_FAILED',
            failingSpace: 'app',
            databaseUnchanged: false,
          },
          afterFailure: { audit: audit.storage.storageHash },
          lockFreeAfterFailure: true,
          rerun: [
            ['audit', 0],
            ['app', 4],
          ],
          afterRerun: { audit: audit.storage.storageHash, app: app.storage.storageHash },
        });
      }),
    );
  });

  it('refuses the second of two runners started at once with a marker origin mismatch, changing nothing', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        const base = loadExampleContract();
        const applied = await apply(family, driver, [
          ['app', await planAgainst(driver, family, 'app', base), base],
        ]);
        if (!applied.ok) throw applied.failure;
        const withNickname = contractWithNickname();
        const planned = mysql.migrations.createPlanner(createAdapter()).plan({
          contract: withNickname,
          schema: await family.introspect({ driver }),
          policy: EVERY_CLASS,
          fromContract: base,
          origin: { storageHash: base.storage.storageHash },
          statements: [],
          frameworkComponents,
          spaceId: 'app',
          snapshotsImportPath: '../../snapshots',
        });
        if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
        const runOnItsOwnConnection = () =>
          withDriver(url, (own, ownFamily) =>
            apply(ownFamily, own, [['app', planned.plan, withNickname]]),
          );

        const outcomes = await Promise.all([runOnItsOwnConnection(), runOnItsOwnConnection()]);

        expect({
          outcomes: outcomes
            .map((outcome) =>
              outcome.ok
                ? 'applied'
                : `${outcome.failure.code} databaseUnchanged=${outcome.failure.meta.databaseUnchanged}`,
            )
            .sort(),
          markers: await markerHashes(family, driver),
          lockFree: await lockIsFree(url),
        }).toEqual({
          outcomes: ['MIGRATION.MARKER_ORIGIN_MISMATCH databaseUnchanged=true', 'applied'],
          markers: { app: withNickname.storage.storageHash },
          lockFree: true,
        });
      }),
    );
  });

  it('says the apply changed nothing when the first space fails before it runs anything', async (test) => {
    await withMysqlDatabase(test, ({ url }) =>
      withDriver(url, async (driver, family) => {
        const app = loadExampleContract();
        const failed = await apply(family, driver, [['app', failingPlan(app), app]]);
        expect(failed.ok ? undefined : failed.failure.meta).toMatchObject({
          failingSpace: 'app',
          databaseUnchanged: true,
        });
      }),
    );
  });
});
