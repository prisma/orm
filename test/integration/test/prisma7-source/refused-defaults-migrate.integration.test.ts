/**
 * A Prisma 7 default whose value the column's codec cannot hold exactly, such as a timestamp with digits below a millisecond read as a JavaScript `Date`, is kept as the SQL the target writes for it. A database Prisma 8 migrates from that contract holds every digit and verifies clean.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import postgres from '@internal/target-postgres/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresFrameworkComponents } from '../scalar-lists/psl-list-authoring';
import { loadPrisma7Schema } from './load-prisma7-schema';

const SCHEMA = `datasource db {
  provider = "postgresql"
}

model Stamp {
  id      Int        @id
  tsMicro DateTime   @default("2024-01-02T03:04:05.123456Z") @db.Timestamp(6)
  ts6l    DateTime[] @default(["2024-01-02T03:04:05.123Z", "2024-01-02T03:04:05.123456Z"]) @db.Timestamp(6)
}
`;

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensions: [],
});
const familyInstance = sql.create(controlStack);

describe('a Prisma 7 default a Date cannot hold, migrated by Prisma 8', {
  concurrent: false,
}, () => {
  let database: DevDatabase | undefined;
  const directory = mkdtempSync(join(tmpdir(), 'prisma7-refused-defaults-'));

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
    rmSync(directory, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'keeps every digit, single and in a list, and verifies clean',
    async () => {
      if (!database) throw new Error('database not initialised');
      const schemaPath = join(directory, 'schema.prisma');
      writeFileSync(schemaPath, SCHEMA);
      const contract = await loadPrisma7Schema(schemaPath);
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
        const verified = familyInstance.verifySchema({
          contract,
          schema: await familyInstance.introspect({ driver, contract }),
          strict: true,
          frameworkComponents: postgresFrameworkComponents,
        });
        expect(verified.schema.issues).toEqual([]);
      } finally {
        await driver.close();
      }
      const row = await withClient(database.connectionString, async (client) => {
        await client.query('INSERT INTO "Stamp" (id) VALUES (1)');
        const read = await client.query<{ micro: string; list: string }>(
          `SELECT "tsMicro"::text AS micro, "ts6l"::text AS list FROM "Stamp"`,
        );
        return read.rows[0];
      });
      expect(row).toEqual({
        micro: '2024-01-02 03:04:05.123456',
        list: '{"2024-01-02 03:04:05.123","2024-01-02 03:04:05.123456"}',
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'writes a year before 1 or after 9999 as PostgreSQL reads it',
    async () => {
      if (!database) throw new Error('database not initialised');
      const timestamp = {
        codecId: 'pg/timestamp-date@1',
        dataType: 'pg/timestamp',
        typeParams: { precision: 6 },
      };
      const timestamptz = {
        codecId: 'pg/timestamptz-date@1',
        dataType: 'pg/timestamptz',
        typeParams: { precision: 6 },
      };
      const expressions = {
        bc: prisma7PostgresBinding.literalDefaultExpression(
          '-000043-03-15T00:00:00.123456',
          timestamp,
        ),
        late: prisma7PostgresBinding.literalDefaultExpression(
          '+010000-01-01T00:00:00.123456Z',
          timestamptz,
        ),
        list: prisma7PostgresBinding.literalDefaultExpression(
          ['-000043-03-15T00:00:00.123456', null],
          timestamp,
        ),
      };
      const read = await withClient(database.connectionString, async (client) => {
        await client.query("SET TIME ZONE 'UTC'");
        const result = await client.query<{ bc: string; late: string; list: string }>(
          `SELECT (${expressions.bc})::text AS bc, (${expressions.late})::text AS late, (${expressions.list})::text AS list`,
        );
        return result.rows[0];
      });
      expect({ expressions, read }).toEqual({
        expressions: {
          bc: "'0044-03-15T00:00:00.123456 BC'::timestamp(6)",
          late: "'10000-01-01T00:00:00.123456Z'::timestamptz(6)",
          list: "ARRAY['0044-03-15T00:00:00.123456 BC', NULL]::timestamp(6)[]",
        },
        read: {
          bc: '0044-03-15 00:00:00.123456 BC',
          late: '10000-01-01 00:00:00.123456+00',
          list: '{"0044-03-15 00:00:00.123456 BC",NULL}',
        },
      });
    },
    timeouts.spinUpPpgDev,
  );
});
