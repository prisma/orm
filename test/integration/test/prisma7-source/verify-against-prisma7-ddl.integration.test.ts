/**
 * Pins three facts the Prisma 7 contract source relies on: how autoincrement()
 * and now() defaults verify, and what lenient verify tolerates.
 *
 * The applied SQL is copied statement by statement from
 * test/integration/test/fixtures/prisma7-source/supported/migration.sql, which
 * prisma@7.10.0 generated; each test keeps only the statements it needs. The
 * expected side is authored with Prisma 8's own TypeScript contract builder and
 * verified through the same family verify path `db verify` runs.
 */
import { timestampTemporalColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import {
  autoincrement,
  defineContract,
  field,
  int4Column,
  model,
  now,
  runSchemaVerify,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from '../family.schema-verify.helpers';

const prisma7Timestamp3 = {
  codecId: 'pg/timestamp-temporal@1',
  nativeType: 'timestamp',
  typeParams: { precision: 3 },
} as const;

describe('db verify against the DDL Prisma 7 generates', () => {
  const { getConnectionString } = useDevDatabase();

  async function applySql(statements: readonly string[]): Promise<void> {
    await withClient(getConnectionString(), async (client) => {
      await client.query('DROP TABLE IF EXISTS "Post", "User", "LegacyThing", "Tag", "Timestamps"');
      for (const statement of statements) {
        await client.query(statement);
      }
    });
  }

  it(
    'autoincrement() verifies against a Prisma 7 SERIAL column with zero findings',
    async () => {
      await applySql([
        `CREATE TABLE "Tag" (
            "id" SERIAL NOT NULL,
            "name" TEXT NOT NULL,
            CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
          )`,
      ]);
      const contract = defineContract({
        models: {
          Tag: model('Tag', {
            fields: {
              id: field.column(int4Column).default(autoincrement()).id(),
              name: field.column(textColumn),
            },
          }).sql({ table: 'Tag' }),
        },
      });

      const serial = await runSchemaVerify(getConnectionString(), contract);
      expect(serial).toMatchObject({ ok: true, schema: { issues: [] } });

      await withClient(getConnectionString(), (client) =>
        client.query('ALTER TABLE "Tag" ALTER COLUMN "id" DROP DEFAULT'),
      );
      const withoutSequence = await runSchemaVerify(getConnectionString(), contract);
      expect(withoutSequence.ok).toBe(false);
      expect(withoutSequence.schema.issues.map((issue) => issue.path)).toEqual([
        ['database', 'public', 'Tag', 'column:id', 'default'],
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'now() on timestamp(3) verifies against a Prisma 7 DEFAULT CURRENT_TIMESTAMP column with zero findings',
    async () => {
      await applySql([
        `CREATE TABLE "Timestamps" (
            "id" SERIAL NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "Timestamps_pkey" PRIMARY KEY ("id")
          )`,
      ]);
      const contract = defineContract({
        models: {
          Timestamps: model('Timestamps', {
            fields: {
              id: field.column(int4Column).default(autoincrement()).id(),
              createdAt: field.column(prisma7Timestamp3).default(now()),
            },
          }).sql({ table: 'Timestamps' }),
        },
      });

      const currentTimestamp = await runSchemaVerify(getConnectionString(), contract);
      expect(currentTimestamp).toMatchObject({ ok: true, schema: { issues: [] } });

      const withoutPrecision = defineContract({
        models: {
          Timestamps: model('Timestamps', {
            fields: {
              id: field.column(int4Column).default(autoincrement()).id(),
              createdAt: field.column(timestampTemporalColumn).default(now()),
            },
          }).sql({ table: 'Timestamps' }),
        },
      });
      const bareTimestamp = await runSchemaVerify(getConnectionString(), withoutPrecision);
      expect(bareTimestamp.ok).toBe(false);
      expect(bareTimestamp.schema.issues.map((issue) => issue.path)).toEqual([
        ['database', 'public', 'Timestamps', 'column:createdAt'],
      ]);

      await withClient(getConnectionString(), (client) =>
        client.query(
          'ALTER TABLE "Timestamps" ALTER COLUMN "createdAt" SET DEFAULT clock_timestamp()',
        ),
      );
      const clockTimestamp = await runSchemaVerify(getConnectionString(), contract);
      expect(clockTimestamp.ok).toBe(false);
      expect(clockTimestamp.schema.issues.map((issue) => issue.path)).toEqual([
        ['database', 'public', 'Timestamps', 'column:createdAt', 'default'],
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'lenient verify reports zero findings for an undeclared table, column, and foreign key',
    async () => {
      await applySql([
        `CREATE TABLE "User" (
            "id" SERIAL NOT NULL,
            "email" TEXT NOT NULL,
            "legacy" TEXT,
            CONSTRAINT "User_pkey" PRIMARY KEY ("id")
          )`,
        `CREATE TABLE "Post" (
            "id" SERIAL NOT NULL,
            "title" TEXT NOT NULL,
            "legacyOwnerId" INTEGER,
            CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
          )`,
        `CREATE TABLE "LegacyThing" (
            "id" INTEGER NOT NULL,
            CONSTRAINT "LegacyThing_pkey" PRIMARY KEY ("id")
          )`,
        `ALTER TABLE "Post" ADD CONSTRAINT "Post_legacyOwnerId_fkey" FOREIGN KEY ("legacyOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
        // Not in the fixture: a foreign key from a declared table to the undeclared one.
        `ALTER TABLE "Post" ADD COLUMN "legacyThingId" INTEGER`,
        `ALTER TABLE "Post" ADD CONSTRAINT "Post_legacyThingId_fkey" FOREIGN KEY ("legacyThingId") REFERENCES "LegacyThing"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      ]);
      const contract = defineContract({
        models: {
          User: model('User', {
            fields: {
              id: field.column(int4Column).default(autoincrement()).id(),
              email: field.column(textColumn),
            },
          }).sql({ table: 'User' }),
          Post: model('Post', {
            fields: {
              id: field.column(int4Column).default(autoincrement()).id(),
              title: field.column(textColumn),
            },
          }).sql({ table: 'Post' }),
        },
      });

      const lenient = await runSchemaVerify(getConnectionString(), contract, { strict: false });
      expect(lenient).toMatchObject({ ok: true, schema: { issues: [] } });

      const strict = await runSchemaVerify(getConnectionString(), contract, { strict: true });
      expect(strict.ok).toBe(false);
      expect(strict.schema.issues.map((issue) => issue.path).sort()).toEqual([
        ['database', 'public', 'LegacyThing'],
        ['database', 'public', 'LegacyThing', 'column:id'],
        ['database', 'public', 'LegacyThing', 'primary-key'],
        ['database', 'public', 'Post', 'column:legacyOwnerId'],
        ['database', 'public', 'Post', 'column:legacyThingId'],
        ['database', 'public', 'Post', 'foreign-key:legacyOwnerId->public.User(id)'],
        ['database', 'public', 'Post', 'foreign-key:legacyThingId->public.LegacyThing(id)'],
        ['database', 'public', 'User', 'column:legacy'],
      ]);
    },
    timeouts.spinUpPpgDev,
  );
});
