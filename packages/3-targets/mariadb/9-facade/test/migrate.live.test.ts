import mariadbAdapter from '@internal/adapter-mariadb/control';
import type { Contract } from '@internal/contract/types';
import mariadbDriver from '@internal/driver-mariadb/control';
import type { MysqlControlDriver } from '@internal/driver-mysql/control';
import sql, { type SqlControlFamilyInstance } from '@internal/family-sql/control';
import {
  createControlStack,
  type MigrationOperationPolicy,
  type MigrationPlan,
  type MigrationRunnerResult,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import mariadb from '@internal/target-mariadb/control';
import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe, expect, it } from 'vitest';
import { emitFixture } from './emit';

const SERVER = 'MARIADB_URL';
const frameworkComponents = [mariadb, mariadbAdapter];
const controlStack = createControlStack({
  family: sql,
  target: mariadb,
  adapter: mariadbAdapter,
  driver: mariadbDriver,
});
const EVERY_CLASS: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

async function withDriver<T>(
  url: string,
  fn: (driver: MysqlControlDriver<'mariadb'>, family: SqlControlFamilyInstance) => Promise<T>,
): Promise<T> {
  const driver = await mariadbDriver.create(url, {
    sessionSettings: mariadb.sessionSettings ?? {},
  });
  try {
    return await fn(driver, sql.create(controlStack));
  } finally {
    await driver.close();
  }
}

async function plan(
  driver: MysqlControlDriver<'mariadb'>,
  family: SqlControlFamilyInstance,
  contract: Contract<SqlStorage>,
): Promise<MigrationPlan> {
  const result = mariadb.migrations.createPlanner(mariadbAdapter.create(controlStack)).plan({
    contract,
    schema: await family.introspect({ driver, contract }),
    policy: EVERY_CLASS,
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents,
    spaceId: 'app',
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result.plan;
}

function apply(
  family: SqlControlFamilyInstance,
  driver: MysqlControlDriver<'mariadb'>,
  migration: MigrationPlan,
  contract: Contract<SqlStorage>,
): Promise<MigrationRunnerResult> {
  return mariadb.migrations.createRunner(family).execute({
    driver,
    perSpaceOptions: [
      {
        space: 'app',
        plan: migration,
        driver,
        destinationContract: contract,
        policy: EVERY_CLASS,
        frameworkComponents,
        strictVerification: false,
        migrationEdges: [
          buildFabricatedMigrationEdge({
            currentMarkerStorageHash: undefined,
            destinationStorageHash: migration.destination.storageHash,
            operationCount: migration.operations.length,
          }),
        ],
      },
    ],
  });
}

async function markerHashes(
  family: SqlControlFamilyInstance,
  driver: MysqlControlDriver<'mariadb'>,
) {
  const markers = await family.readAllMarkers({ driver });
  return Object.fromEntries([...markers].map(([space, marker]) => [space, marker.storageHash]));
}

describe('migrating a MariaDB database', { timeout: timeouts.databaseOperation }, () => {
  it.for([
    ['the example contract', 'example'],
    ['a contract with literal and function defaults', 'defaults'],
  ] as const)(
    'applies %s, which then verifies strictly, plans nothing more and signs as unchanged',
    async ([, fixture], test) => {
      const { contract } = await emitFixture(fixture);
      await withMysqlDatabase(
        test,
        ({ url }) =>
          withDriver(url, async (driver, family) => {
            const applied = await apply(
              family,
              driver,
              await plan(driver, family, contract),
              contract,
            );
            if (!applied.ok) throw applied.failure;
            const verified = family.verifySchema({
              contract,
              schema: await family.introspect({ driver, contract }),
              strict: true,
              frameworkComponents,
            });
            const again = await plan(driver, family, contract);
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
              verified: verified.ok ? true : verified,
              planAgain: again.operations.length,
              markers: await markerHashes(family, driver),
              signed: signed.map(({ status }) => status),
            }).toEqual({
              verified: true,
              planAgain: 0,
              markers: { app: contract.storage.storageHash },
              signed: ['unchanged'],
            });
          }),
        SERVER,
      );
    },
  );

  it('signs a database made by hand, creating the marker table first', async (test) => {
    const { contract } = await emitFixture('defaults');
    await withMysqlDatabase(
      test,
      ({ url }) =>
        withDriver(url, async (driver, family) => {
          await driver.query(`CREATE TABLE \`Item\` (
            \`id\` int(11) NOT NULL,
            \`label\` varchar(191) NOT NULL DEFAULT 'it''s',
            \`count\` int(11) NOT NULL DEFAULT 0,
            \`total\` bigint(20) NOT NULL DEFAULT 10,
            \`role\` enum('USER','ADMIN') NOT NULL DEFAULT 'USER',
            \`nickname\` varchar(191) DEFAULT NULL,
            \`createdAt\` datetime(3) NOT NULL DEFAULT current_timestamp(3),
            \`day\` date NOT NULL DEFAULT curdate(),
            PRIMARY KEY (\`id\`)
          )`);
          const signed = await family.signSpaces({
            driver,
            spaces: [{ space: 'app', contract, expected: null }],
          });
          expect({
            signed: signed.map(({ status }) => status),
            markers: await markerHashes(family, driver),
          }).toEqual({ signed: ['created'], markers: { app: contract.storage.storageHash } });
        }),
      SERVER,
    );
  });
});
