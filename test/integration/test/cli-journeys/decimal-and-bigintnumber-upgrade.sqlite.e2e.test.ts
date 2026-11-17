/**
 * Upgrading a SQLite project whose `Decimal` and `BigIntNumber` fields change codec (SQLite).
 *
 * Before the upgrade a `Decimal` field emitted `sqlite/text@1` and a `BigIntNumber` field `sqlite/bigintnumber@1`. Now they emit `sqlite/decimal@1` and `sqlite/integer@1`. Neither column changes. The old contract is written in TypeScript with the codec ids the old names emitted, because no name emits them any more.
 *
 * Journey U1 signs a database with the old contract, emits the new one, and checks what `db verify` and `migration plan` report. Journey U2 adds a required `Decimal` field to a table that has rows and reads the value it was filled with.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  readEmittedContractStorageHash,
  runContractEmit,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

const OLD_CONTRACT_TS = `import { integerNumberColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import { SQLITE_BIGINT_NUMBER_CODEC_ID } from '@internal/target-sqlite/codec-ids';
import { defineContract } from '@internal/sqlite/contract-builder';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Invoice: model('Invoice', {
      fields: {
        id: field.column(integerNumberColumn).id(),
        total: field.column(textColumn),
        visits: field.column({ codecId: SQLITE_BIGINT_NUMBER_CODEC_ID }),
      },
    }).sql({ table: 'invoice' }),
  },
}));
`;

const NEW_CONTRACT_TS = `import { defineContract } from '@internal/sqlite/contract-builder';

export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Invoice: model('Invoice', {
      fields: {
        id: field.column(type.Int()).id(),
        total: field.column(type.Decimal()),
        visits: field.column(type.BigIntNumber()),
      },
    }).sql({ table: 'invoice' }),
  },
}));
`;

function typescriptConfig(dbPath: string): string {
  return `import sqliteAdapter from '@internal/adapter-sqlite/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import sqlite from '@internal/target-sqlite/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions: [],
    contract: {
      source: { format: 'typescript', load: async () => ({ ok: true as const, value: contract }) },
      output: 'contract.json',
      types: 'contract.d.ts',
    },
    db: { connection: ${JSON.stringify(dbPath)} },
    migrations: { dir: 'migrations' },
  }),
});
`;
}

const FROM_PSL = `// use prisma-8

model Invoice {
  id    Int @id
  label String

  @@map("invoice")
}
`;

const TO_PSL = FROM_PSL.replace('  label String\n', '  label String\n  total Decimal\n');

type SqliteJourney = JourneyContext & { readonly dbPath: string };

function setupTypescriptJourney(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, typescriptConfig(dbPath), 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

function setupPslJourney(createTempDir: () => string): SqliteJourney {
  const testDir = createTempDir();
  const dbPath = join(testDir, 'journey.db');
  const configPath = join(testDir, 'prisma.config.ts');
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8').replace('{{DB_PATH}}', () => dbPath);
  writeFileSync(configPath, config, 'utf-8');
  writeProjectManifest(testDir);
  return { testDir, configPath, outputDir: testDir, dbPath };
}

async function emit(ctx: JourneyContext, file: string, source: string, label: string) {
  writeFileSync(join(ctx.testDir, file), source, 'utf-8');
  const result = await runContractEmit(ctx);
  expect(result.exitCode, `${label}: emit: ${result.stderr}`).toBe(0);
}

function emittedCodecIds(ctx: JourneyContext): Record<string, unknown> {
  const contract = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
  const columns = contract.storage.namespaces.__unbound__.entries.table.invoice.columns;
  return Object.fromEntries(
    Object.entries(columns).map(([name, column]) => [
      name,
      (column as { readonly codecId: unknown }).codecId,
    ]),
  );
}

function query(dbPath: string, sql: string): readonly Record<string, unknown>[] {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

interface PlanOutput {
  readonly operations: readonly { readonly id: string }[];
  readonly changedStorageEntities: readonly unknown[];
  readonly summary: string;
}

withTempDir(({ createTempDir }) => {
  describe('Journey U1 (SQLite): a database signed with the contract the old Decimal and BigIntNumber emitted', () => {
    it(
      'needs no table rebuild: migration plan writes no operation, and migrate signs the database with the new contract',
      async () => {
        const ctx = setupTypescriptJourney(createTempDir);
        await emit(ctx, 'contract.ts', OLD_CONTRACT_TS, 'U1.01');
        expect(emittedCodecIds(ctx), 'U1.01: the old codecs').toEqual({
          id: 'sqlite/integer@1',
          total: 'sqlite/text@1',
          visits: 'sqlite/bigintnumber@1',
        });
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `U1.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'U1.03: migrate initial').toBe(0);
        query(ctx.dbPath, `INSERT INTO "invoice" ("id", "total", "visits") VALUES (1, '12.50', 3)`);
        const origin = latestMigrationDirName(ctx);

        await emit(ctx, 'contract.ts', NEW_CONTRACT_TS, 'U1.04');
        expect(emittedCodecIds(ctx), 'U1.04: the new codecs').toEqual({
          id: 'sqlite/integer@1',
          total: 'sqlite/decimal@1',
          visits: 'sqlite/integer@1',
        });

        const verifyBefore = await runDbVerify(ctx);
        expect(
          {
            exitCode: verifyBefore.exitCode,
            mismatch: `${verifyBefore.stdout}${verifyBefore.stderr}`.includes(
              'CONTRACT.MARKER_MISMATCH',
            ),
          },
          `U1.05: db verify before migrating: ${verifyBefore.stdout}${verifyBefore.stderr}`,
        ).toEqual({ exitCode: 4, mismatch: true });
        const schemaVerify = await runDbVerify(ctx, ['--schema-only']);
        expect(
          schemaVerify.exitCode,
          `U1.05: the columns match the new contract: ${schemaVerify.stdout}${schemaVerify.stderr}`,
        ).toBe(0);

        const plan = await runMigrationPlan(ctx, ['--from', origin, '--name', 'upgrade', '--json']);
        expect(plan.exitCode, `U1.06: plan: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<PlanOutput>(plan);
        expect(
          { operations: planned.operations, changed: planned.changedStorageEntities },
          'U1.06: no operation, and so no table rebuild',
        ).toEqual({
          operations: [],
          changed: [{ plane: 'storage', entityKind: 'table', entityName: 'invoice' }],
        });

        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `U1.07: migrate: ${applied.stderr}`).toBe(0);
        expect(
          query(ctx.dbPath, `SELECT core_hash FROM "_prisma_marker" WHERE space = 'app'`),
          'U1.07: the marker',
        ).toEqual([{ core_hash: readEmittedContractStorageHash(ctx) }]);
        const verifyAfter = await runDbVerify(ctx);
        expect(
          verifyAfter.exitCode,
          `U1.08: db verify after migrating: ${verifyAfter.stderr}`,
        ).toBe(0);
        expect(
          query(ctx.dbPath, 'SELECT "id", "total", "visits" FROM "invoice"'),
          'U1.08: no data moved',
        ).toEqual([{ id: 1, total: '12.50', visits: 3 }]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey U2 (SQLite): a required Decimal field added to a table that has rows', () => {
    it(
      'fills the rows with 0',
      async () => {
        const ctx = setupPslJourney(createTempDir);
        await emit(ctx, 'contract.prisma', FROM_PSL, 'U2.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `U2.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'U2.03: migrate initial').toBe(0);
        query(ctx.dbPath, `INSERT INTO "invoice" ("id", "label") VALUES (1, 'first')`);
        const origin = latestMigrationDirName(ctx);

        await emit(ctx, 'contract.prisma', TO_PSL, 'U2.04');
        const added = await runMigrationPlan(ctx, ['--from', origin, '--name', 'total']);
        expect(added.exitCode, `U2.05: plan: ${added.stderr}`).toBe(0);
        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `U2.06: migrate: ${applied.stderr}`).toBe(0);

        expect(query(ctx.dbPath, 'SELECT "id", "total" FROM "invoice"'), 'U2.06: the fill').toEqual(
          [{ id: 1, total: '0' }],
        );
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `U2.07: db verify: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
