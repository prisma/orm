/**
 * Preflight gap coverage for `db update` — pins the externally-visible behavior
 * of two walk-schema branches that the `cli.db-update.e2e.test.ts` scenarios do
 * not exercise:
 *
 *   1. FK backing-index creation on an **existing** table when the contract
 *      gains a new FK with `index: true` (the default).
 *   2. Empty-table-guarded NOT-NULL column add when the shared-temp-default
 *      strategy is unsafe (here: the new column is part of a new unique
 *      constraint, so the placeholder value would violate uniqueness).
 *
 * These tests must pass against today's walk-schema planner. They act as the
 * regression net while the issue planner absorbs these branches in Phase 4.
 */

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { fixtureAppDir, runOnEngine, withTempDir } from './utils/cli-test-helpers';
import { runDbInit } from './utils/db-init-test-helpers';
import {
  type DbUpdateTestSetup,
  runDbUpdate,
  runDbUpdateAllowFailure,
  setupDbUpdateFixture,
} from './utils/db-update-test-helpers';

const fixtureSubdir = 'db-update-preflight-gaps';

async function swapToVariant(testSetup: DbUpdateTestSetup, variantFile: string): Promise<void> {
  const variantSource = join(fixtureAppDir, 'fixtures', fixtureSubdir, variantFile);
  copyFileSync(variantSource, join(testSetup.testDir, 'contract.ts'));

  const emit = await runOnEngine(testSetup, ['contract', 'emit']);
  expect(emit.exitCode).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('db update preflight gaps', () => {
    // Gap 1 — FK backing-index creation on an existing table.
    //
    // Walk-schema emits the backing index via `buildFkBackingIndexOperations`
    // whenever `fk.index !== false` and no user-declared index already covers
    // the FK columns. This test pins that behavior end-to-end so the Phase 4
    // `fk_backing_index_missing` absorption can be validated against it.
    it(
      'creates the FK backing index when a new FK is added to an existing table',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          // Precondition: post table exists without FK or backing index
          await withClient(connectionString, async (client) => {
            const before = await client.query<{ indexname: string }>(
              `SELECT indexname FROM pg_indexes
               WHERE schemaname = 'public' AND tablename = 'post'`,
            );
            expect(before.rows.map((r) => r.indexname)).not.toContain('post_userId_idx');
          });

          await swapToVariant(testSetup, 'contract-add-fk.ts');

          const run = await runDbUpdate(testSetup, ['--config', configPath]);
          expect(run.exitCode).toBe(0);

          await withClient(connectionString, async (client) => {
            const fkRows = await client.query<{ conname: string }>(
              `SELECT conname FROM pg_constraint
               WHERE conrelid = '"public"."post"'::regclass AND contype = 'f'`,
            );
            expect(fkRows.rows.map((r) => r.conname)).toContain('post_userId_fkey');

            const idxRows = await client.query<{ indexname: string }>(
              `SELECT indexname FROM pg_indexes
               WHERE schemaname = 'public' AND tablename = 'post'`,
            );
            expect(idxRows.rows.map((r) => r.indexname)).toContain('post_userId_idx_a489d58a');
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Gap 2a — Empty-table-guarded NOT-NULL column add, happy path.
    //
    // The shared-temp-default strategy is unsafe (the new column is part of a
    // new unique constraint), so `buildAddColumnItem` falls through to the
    // hand-built op with a `tableIsEmptyCheck` precheck. On an empty table the
    // precheck passes and the add succeeds.
    it(
      'adds a required-unique column on an empty table via the empty-table guard',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          // Table is empty — no INSERT between init and update.

          await swapToVariant(testSetup, 'contract-add-required-unique.ts');

          const run = await runDbUpdate(testSetup, ['--config', configPath]);
          expect(run.exitCode).toBe(0);

          await withClient(connectionString, async (client) => {
            const col = await client.query<{ is_nullable: string; column_default: string | null }>(
              `SELECT is_nullable, column_default FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'handle'`,
            );
            expect(col.rows).toHaveLength(1);
            expect(col.rows[0]).toMatchObject({ is_nullable: 'NO', column_default: null });

            const uniq = await client.query<{ conname: string }>(
              `SELECT conname FROM pg_constraint
               WHERE conrelid = '"public"."user"'::regclass AND contype = 'u'`,
            );
            expect(uniq.rows.map((r) => r.conname)).toContain('user_handle_key');
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    // Gap 2b — Empty-table-guarded NOT-NULL column add, non-empty failure path.
    //
    // When the table is not empty, the precheck `tableIsEmptyCheck` fails and
    // `db update` surfaces the guarded error instead of letting Postgres raise
    // a raw NOT-NULL violation on existing rows.
    it(
      'fails with the empty-table guard when adding a required-unique column to a non-empty table',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          await withClient(connectionString, async (client) => {
            await client.query(
              `INSERT INTO "public"."user" ("id", "email") VALUES (1, 'alice@example.com')`,
            );
          });

          await swapToVariant(testSetup, 'contract-add-required-unique.ts');

          const run = await runDbUpdateAllowFailure(testSetup, ['--config', configPath]);
          expect(run.exitCode).not.toBe(0);

          await withClient(connectionString, async (client) => {
            const col = await client.query<{ column_name: string }>(
              `SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'handle'`,
            );
            expect(col.rows).toHaveLength(0);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
