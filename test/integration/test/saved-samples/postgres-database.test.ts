/**
 * Each saved PostgreSQL sample set, run by this release against an in-process database: the saved migrations apply to an empty database, and a database whose Prisma tables hold the rows the saved release wrote is read as up to date and can be queried.
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
  loadPostgresRecords,
  sampleDatabaseDir,
  sampleSetExists,
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

function savedLedgerNames(release: string): string[] {
  const rows = JSON.parse(
    readFileSync(join(sampleDatabaseDir(release, 'postgres'), 'ledger.json'), 'utf8'),
  ) as readonly { readonly space: string; readonly migration_name: string }[];
  return rows.map((row) => `${row.space}/${row.migration_name}`);
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
          await loadPostgresRecords(connectionString, sampleDatabaseDir(release, 'postgres'));

          const status = await runMigrationStatus(ctx, ['--json']);
          expect(status.exitCode, `migration status: ${status.stdout}\n${status.stderr}`).toBe(0);
          const statusJson = parseMigrationStatusJson(status);
          for (const space of ['app', 'pgvector']) {
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

          const contractJson = JSON.parse(
            readFileSync(join(ctx.testDir, emittedContractPath.postgres), 'utf8'),
          );
          await createRowThroughOrm({
            contractJson,
            connectionString,
            extensions: [pgvector],
            model: 'User',
            row: { email: 'ada@example.com', role: 'ADMIN', displayName: 'Ada' },
          });
          expect(
            await selectRows({
              contractJson,
              connectionString,
              extensions: [pgvector],
              table: 'user',
              columns: ['email', 'role', 'displayName'],
            }),
          ).toEqual([{ email: 'ada@example.com', role: 'ADMIN', displayName: 'Ada' }]);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
