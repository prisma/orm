import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { integerBooleanColumn, integerNumberColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { Contract } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  createControlStack,
  planOriginOf,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import { defineContract, field, model } from '@internal/sqlite/contract-builder';
import sqliteTarget from '@internal/target-sqlite/control';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const controlStack = createControlStack({
  family: sql,
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
  extensions: [],
});
const familyInstance = sql.create(controlStack);
const planner = sqliteTarget.createPlanner(sqliteAdapter.create(controlStack));
const frameworkComponents = [sqliteTarget, sqliteAdapter] as const;

const contract = defineContract({
  models: {
    Account: model('Account', {
      fields: {
        id: field.column(integerNumberColumn).id(),
        active: field.column(integerBooleanColumn).default(true),
        hidden: field.column(integerBooleanColumn).default(false),
        admin: field.column(integerBooleanColumn).optional(),
      },
    }).sql({ table: 'account' }),
  },
}) as unknown as Contract<SqlStorage>;

describe('a Boolean column with a default on SQLite', () => {
  it('is created as an integer whose default is 1 or 0, verifies with no issue, plans no change and fills a row', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-boolean-defaults-'));
    const driver = await sqliteDriver.create(join(directory, 'test.db'));
    try {
      const planResult = planner.plan({
        contract,
        schema: await familyInstance.introspect({ driver }),
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (planResult.kind !== 'success') {
        throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
      }
      const operations = await Promise.all(planResult.plan.operations);
      const createTable = operations.find((op) => op.id === 'table.account');
      const applied = await sqliteTarget.createRunner(familyInstance).execute({
        driver,
        perSpaceOptions: [
          {
            space: APP_SPACE_ID,
            plan: planResult.plan,
            migrationEdges: [
              buildFabricatedMigrationEdge({
                currentMarkerStorageHash: planResult.plan.origin?.storageHash,
                destinationStorageHash: planResult.plan.destination.storageHash,
                operationCount: planResult.plan.operations.length,
              }),
            ],
            driver,
            destinationContract: contract,
            policy: INIT_ADDITIVE_POLICY,
            frameworkComponents,
          },
        ],
      });
      const introspected = await familyInstance.introspect({ driver, contract });
      const verified = familyInstance.verifySchema({
        contract,
        schema: introspected,
        strict: false,
        frameworkComponents,
      });
      const replanned = planner.plan({
        contract,
        schema: introspected,
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
        fromContract: contract,
        origin: planOriginOf(contract),
        statements: [],
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      let rows: unknown;
      if (applied.ok) {
        await driver.query('insert into account (id) values (1)');
        rows = (await driver.query('select active, hidden, admin from account')).rows;
      }

      expect({
        createTable: createTable?.execute.map((step) => step.sql),
        applied: applied.ok ? true : applied.failure,
        issues: verified.schema.issues,
        replannedOperations:
          replanned.kind === 'success'
            ? (await Promise.all(replanned.plan.operations)).map((op) => op.id)
            : replanned,
        rows,
      }).toEqual({
        createTable: [
          'CREATE TABLE "account" (\n  "id" INTEGER NOT NULL,\n  "active" INTEGER NOT NULL DEFAULT 1,\n  "hidden" INTEGER NOT NULL DEFAULT 0,\n  "admin" INTEGER,\n  PRIMARY KEY ("id")\n)',
        ],
        applied: true,
        issues: [],
        replannedOperations: [],
        rows: [{ active: 1, hidden: 0, admin: null }],
      });
    } finally {
      await driver.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
