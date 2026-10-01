import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { integerColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { Contract } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
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

const sqlFloat = { codecId: 'sql/float@1', nativeType: 'real' } as const;
const sqliteReal = { codecId: 'sqlite/real@1', nativeType: 'real' } as const;

const contract = defineContract({
  models: {
    Reading: model('Reading', {
      fields: {
        id: field.column(integerColumn).id(),
        floatUp: field.column(sqlFloat).column('float_up').default(Number.POSITIVE_INFINITY),
        floatDown: field.column(sqlFloat).column('float_down').default(Number.NEGATIVE_INFINITY),
        realUp: field.column(sqliteReal).column('real_up').default(Number.POSITIVE_INFINITY),
        realDown: field.column(sqliteReal).column('real_down').default(Number.NEGATIVE_INFINITY),
      },
    }).sql({ table: 'reading' }),
  },
}) as unknown as Contract<SqlStorage>;

describe('an infinite float default on SQLite', () => {
  it('applies, verifies against the database with no issue, plans no change and fills a row', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pn-sqlite-float-defaults-'));
    const driver = await sqliteDriver.create(join(directory, 'test.db'));
    try {
      const planResult = planner.plan({
        contract,
        schema: await familyInstance.introspect({ driver }),
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (planResult.kind !== 'success') {
        throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
      }
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
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      let rows: unknown;
      if (applied.ok) {
        await driver.query('insert into reading (id) values (1)');
        rows = (await driver.query('select float_up, float_down, real_up, real_down from reading'))
          .rows;
      }

      expect({
        applied: applied.ok ? true : applied.failure,
        issues: verified.schema.issues,
        replannedOperations:
          replanned.kind === 'success'
            ? (await Promise.all(replanned.plan.operations)).map((op) => op.id)
            : replanned,
        rows,
      }).toEqual({
        applied: true,
        issues: [],
        replannedOperations: [],
        rows: [
          {
            float_up: Number.POSITIVE_INFINITY,
            float_down: Number.NEGATIVE_INFINITY,
            real_up: Number.POSITIVE_INFINITY,
            real_down: Number.NEGATIVE_INFINITY,
          },
        ],
      });
    } finally {
      await driver.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
