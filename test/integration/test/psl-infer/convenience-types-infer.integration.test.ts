/**
 * `contract infer` writes each date and time column as the convenience type whose default path reads it, with only the arguments that differ from the defaults. The inferred schema emits, verifies clean against the database it was read from, and plans no migration.
 */
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { printPsl } from '@internal/psl-printer';
import postgres from '@internal/target-postgres/control';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authorSqlContractFromPsl,
  postgresFrameworkComponents,
} from '../scalar-lists/psl-list-authoring';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensions: [],
});
const familyInstance = sql.create(controlStack);

const EVENT_TABLE = `CREATE TABLE event (
  id       int4 PRIMARY KEY,
  at       timestamptz,
  paid_at  timestamptz(3),
  legacy   timestamp(3),
  day      date,
  opens    time(0),
  local_at timetz,
  span     interval,
  micro    timestamptz(6) DEFAULT '2024-01-01 01:00:00.123456+00',
  milli    timestamptz(3) DEFAULT '2024-01-01 01:00:00.123+00'
)`;

function fieldLines(printed: string): readonly string[] {
  return printed
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => /^(at|paidAt|legacy|day|opens|localAt|span|micro|milli) /.test(line));
}

describe('contract infer over date and time columns', { concurrent: false }, () => {
  let database: DevDatabase | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'writes the convenience types, which emit, verify clean and plan no migration',
    async () => {
      if (!database) throw new Error('database not initialised');
      await withClient(database.connectionString, async (client) => {
        await client.query(EVENT_TABLE);
      });
      const driver = await postgresControlDriver.create(database.connectionString);
      try {
        const schema = await familyInstance.introspect({ driver });
        const inferred = printPsl(await familyInstance.inferPslContract(schema), {
          pslBlockDescriptors: controlStack.authoringContributions.pslBlockDescriptors,
        });
        expect(fieldLines(inferred)).toEqual([
          'at DateTime(precision: 6)?',
          'paidAt DateTime? @map("paid_at")',
          'legacy DateTime(storage: timestamp)?',
          'day Date?',
          'opens Time(precision: 0)?',
          'localAt Time(storage: timetz)? @map("local_at")',
          'span Duration?',
          "micro DateTime(precision: 6)? @default(sql`'2024-01-01 01:00:00.123456+00'::timestamp with time zone`)",
          'milli DateTime? @default(timestamptz`2024-01-01T01:00:00.123Z`)',
        ]);

        const emitted = await authorSqlContractFromPsl(
          inferred.replace(/^\/\/ use prisma-8\n/, ''),
        );
        expect(emitted.diagnostics).toEqual([]);
        const contract = emitted.contract;
        if (!contract) throw new Error('the inferred schema produced no contract');

        const verified = familyInstance.verifySchema({
          contract,
          schema: await familyInstance.introspect({ driver, contract }),
          strict: true,
          frameworkComponents: postgresFrameworkComponents,
        });
        expect(verified.schema.issues).toEqual([]);

        const planned = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
          contract,
          schema: await familyInstance.introspect({ driver, contract }),
          policy: INIT_ADDITIVE_POLICY,
          fromContract: null,
          origin: null,
          statements: [],
          frameworkComponents: postgresFrameworkComponents,
          spaceId: APP_SPACE_ID,
          snapshotsImportPath: '../../snapshots',
        });
        expect(planned.kind === 'success' ? planned.plan.operations : planned).toEqual([]);
      } finally {
        await driver.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
  it(
    'applies a microsecond default written as a raw expression with every digit',
    async () => {
      if (!database) throw new Error('database not initialised');
      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      const authored = await authorSqlContractFromPsl(`model Stamp {
  id    Int                    @id
  micro DateTime(precision: 6) @default(sql\`'2024-01-01 01:00:00.123456+00'::timestamp with time zone\`)
  @@map("stamp")
}`);
      expect(authored.diagnostics).toEqual([]);
      const contract = authored.contract;
      if (!contract) throw new Error('authoring produced no contract');
      const driver = await postgresControlDriver.create(database.connectionString);
      try {
        const planned = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
          contract,
          schema: await familyInstance.introspect({ driver }),
          policy: INIT_ADDITIVE_POLICY,
          fromContract: null,
          origin: null,
          statements: [],
          frameworkComponents: postgresFrameworkComponents,
          spaceId: APP_SPACE_ID,
          snapshotsImportPath: '../../snapshots',
        });
        if (planned.kind !== 'success') throw new Error(JSON.stringify(planned));
        const run = await postgres.createRunner(familyInstance).execute({
          driver,
          perSpaceOptions: [
            {
              space: APP_SPACE_ID,
              plan: planned.plan,
              migrationEdges: [
                buildFabricatedMigrationEdge({
                  currentMarkerStorageHash: planned.plan.origin?.storageHash,
                  destinationStorageHash: planned.plan.destination.storageHash,
                  operationCount: planned.plan.operations.length,
                }),
              ],
              driver,
              destinationContract: contract,
              policy: INIT_ADDITIVE_POLICY,
              frameworkComponents: postgresFrameworkComponents,
            },
          ],
        });
        expect(run.ok ? 'ok' : JSON.stringify(run.failure).slice(0, 1500)).toBe('ok');
      } finally {
        await driver.close();
      }
      const stored = await withClient(database.connectionString, async (client) => {
        const columnDefault = await client.query<{ value: string }>(
          `SELECT column_default AS "value" FROM information_schema.columns
           WHERE table_name = 'stamp' AND column_name = 'micro'`,
        );
        await client.query('INSERT INTO stamp (id) VALUES (1)');
        const row = await client.query<{ value: string }>(
          `SELECT (micro AT TIME ZONE 'UTC')::text AS "value" FROM stamp`,
        );
        return { columnDefault: columnDefault.rows[0]?.value, row: row.rows[0]?.value };
      });
      expect(stored).toEqual({
        columnDefault: "'2024-01-01 01:00:00.123456+00'::timestamp with time zone",
        row: '2024-01-01 01:00:00.123456',
      });
    },
    timeouts.spinUpPpgDev,
  );
});
