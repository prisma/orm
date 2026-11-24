/**
 * Each saved PostgreSQL sample set, run by this release against an in-process database: the saved migrations apply to an empty database, and a database whose Prisma tables are as the saved release created them, holding the rows it wrote, is read as up to date, keeps every saved row, and can be queried.
 */

import { readFileSync } from 'node:fs';
import pgvector from '@internal/extension-pgvector/runtime';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  migrationStatusAppSpace,
  parseMigrationStatusJson,
  runDbVerify,
  runMigrate,
  runMigrationStatus,
} from '../utils/journey-test-helpers';
import { createRowThroughOrm, selectRows } from '../utils/journey-workspace-helpers';
import {
  copySampleProject,
  emittedContractPath,
  postgresSchemaFile,
  readPostgresRows,
  readSampleJson,
  restorePostgresRecords,
  type SavedSchema,
  sampleDatabaseDir,
  sampleQueryPath,
  sampleSetExists,
  sampleSpaces,
  savedReleases,
} from './sample-projects';

const releases = savedReleases().filter((release) => sampleSetExists(release, 'postgres'));

async function expectMigrated(ctx: JourneyContext): Promise<void> {
  const migrated = await runMigrate(ctx);
  expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
}

async function expectVerified(ctx: JourneyContext): Promise<void> {
  const verified = await runDbVerify(ctx);
  expect(verified.exitCode, `db verify: ${verified.stdout}\n${verified.stderr}`).toBe(0);
}

async function ledgerNames(connectionString: string): Promise<string[]> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT space, migration_name FROM prisma_contract.ledger ORDER BY id',
    );
    return result.rows.map((row) => `${row.space}/${row.migration_name}`);
  });
}

function savedRows(release: string, table: string): Record<string, unknown>[] {
  return readSampleJson(join(sampleDatabaseDir(release, 'postgres'), `${table}.json`)) as Record<
    string,
    unknown
  >[];
}

function savedLedgerNames(release: string): string[] {
  return savedRows(release, 'ledger').map((row) => `${row['space']}/${row['migration_name']}`);
}

/** The runtime pack of each extension a contract names, so a set's contract decides which packs its queries need. */
const runtimePacks = { pgvector };

function runtimePacksFor(contractJson: { readonly extensions: Record<string, unknown> }) {
  return Object.keys(contractJson.extensions).map((id) => {
    if (!Object.hasOwn(runtimePacks, id)) {
      throw new Error(`The saved contract uses the extension ${id}; add its runtime pack here.`);
    }
    return runtimePacks[id as keyof typeof runtimePacks];
  });
}

interface SavedQuery {
  readonly model: string;
  readonly table: string;
  readonly row: Record<string, unknown>;
}

withTempDir(({ createTempDir }) => {
  describe.each(releases)('the PostgreSQL sample set %s', (release) => {
    it(
      'applies to an empty database, which then verifies',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = copySampleProject(release, 'postgres', createTempDir(), connectionString);

          await expectMigrated(ctx);
          expect(await ledgerNames(connectionString)).toEqual(savedLedgerNames(release));
          await expectVerified(ctx);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'is up to date on a database holding the records it saved, and the database can be queried',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = copySampleProject(release, 'postgres', createTempDir(), connectionString);
          await expectMigrated(ctx);
          await restorePostgresRecords(connectionString, sampleDatabaseDir(release, 'postgres'));

          const status = await runMigrationStatus(ctx, ['--json']);
          expect(status.exitCode, `migration status: ${status.stdout}\n${status.stderr}`).toBe(0);
          const statusJson = parseMigrationStatusJson(status);
          for (const space of sampleSpaces(release, 'postgres')) {
            const { currentContract, targetContract, migrations } = migrationStatusAppSpace(
              statusJson,
              space,
            );
            const named = (status: string) =>
              migrations.filter((m) => m.status === status).map((m) => `${space}/${m.name}`);
            expect({
              currentContract,
              applied: named('applied').sort(),
              pending: named('pending'),
            }).toEqual({
              currentContract: targetContract,
              applied: savedLedgerNames(release)
                .filter((name) => name.startsWith(`${space}/`))
                .sort(),
              pending: [],
            });
          }

          const migrated = await runMigrate(ctx);
          expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
          expect(migrated.stderr).toContain('Already up to date');
          expect(await ledgerNames(connectionString)).toEqual(savedLedgerNames(release));

          await expectVerified(ctx);

          const { tables } = readSampleJson(
            join(sampleDatabaseDir(release, 'postgres'), postgresSchemaFile),
          ) as SavedSchema;
          for (const { name } of tables) {
            const saved = savedRows(release, name);
            expect(await readPostgresRows(connectionString, name), name).toEqual(
              expect.arrayContaining(saved.map((row) => expect.objectContaining(row))),
            );
          }

          const contractJson = JSON.parse(
            readFileSync(join(ctx.testDir, emittedContractPath.postgres), 'utf8'),
          );
          const extensions = runtimePacksFor(contractJson);
          const query = readSampleJson(sampleQueryPath(release, 'postgres')) as SavedQuery;
          await createRowThroughOrm({
            contractJson,
            connectionString,
            extensions,
            model: query.model,
            row: query.row,
          });
          expect(
            await selectRows({
              contractJson,
              connectionString,
              extensions,
              table: query.table,
              columns: Object.keys(query.row),
            }),
          ).toEqual([query.row]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
