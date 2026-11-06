import { rmSync } from 'node:fs';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';
import { runDbUpdateAllowFailure, setupDbUpdateFixture } from './utils/db-update-test-helpers';

/**
 * Integration coverage for the marker-aware contract-space verifier wired
 * into `db update`. Locks two `db update`-level rejection cases:
 *
 * - `db update` rejects when an orphan marker row exists in the database
 *   (a marker for a space that is not declared in `extensions`).
 * - `db update` rejects when an extension is declared in `extensions`
 *   but no pinned `migrations/<space-id>/` directory exists on disk yet
 *   (`declaredButUnmigrated`).
 *
 * Pre-amendment, `db update` ran neither verifier — both kinds of
 * violation slipped through. Post-amendment, both checks fire as
 * preconditions before any apply work.
 */
withTempDir(({ createTempDir }) => {
  describe('db update command - contract-space verifier wiring', () => {
    it(
      'rejects when an orphan marker row exists for a space not in extensions (AC-13)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          await withClient(connectionString, async (client) => {
            await client.query('CREATE SCHEMA IF NOT EXISTS prisma_contract');
            await client.query(`
              CREATE TABLE IF NOT EXISTS prisma_contract.marker (
                space TEXT NOT NULL PRIMARY KEY DEFAULT 'app',
                core_hash TEXT NOT NULL,
                profile_hash TEXT NOT NULL,
                contract_json JSONB,
                canonical_version INTEGER,
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                app_tag TEXT,
                meta JSONB DEFAULT '{}',
                invariants TEXT[] NOT NULL DEFAULT '{}'
              )
            `);
            await client.query(`
              INSERT INTO prisma_contract.marker (space, core_hash, profile_hash, contract_json)
              VALUES ('retired-extension', 'retired', 'retired-profile', '{}')
              ON CONFLICT (space) DO NOTHING
            `);
          });

          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            'db-init',
          );

          const run = await runDbUpdateAllowFailure(testSetup, ['--config', configPath, '--json']);
          expect(run.exitCode).not.toBe(0);

          const errorJson = run.document as Record<string, unknown>;

          expect(errorJson).toMatchObject({
            code: 'MIGRATION.CONTRACT_SPACE_VIOLATION',
          });
          const meta = errorJson['meta'] as
            | { violations?: Array<{ kind: string; spaceId: string }> }
            | undefined;
          const kinds = (meta?.violations ?? []).map((v) => v.kind);
          const spaces = (meta?.violations ?? []).map((v) => v.spaceId);
          expect(kinds).toContain('orphanMarker');
          expect(spaces).toContain('retired-extension');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'rejects when an extension declares a contractSpace but no pinned migrations dir exists (AC-16)',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const testSetup = setupTestDirectoryFromFixtures(
            createTempDir,
            'db-init-with-contract-space',
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const { configPath } = testSetup;

          const emit = await runOnEngine(testSetup, ['contract', 'emit']);
          expect(emit.exitCode).toBe(0);
          rmSync(join(testSetup.testDir, 'migrations', 'test-contract-space'), {
            recursive: true,
          });

          const run = await runDbUpdateAllowFailure(testSetup, ['--config', configPath, '--json']);
          expect(run.exitCode).not.toBe(0);

          const errorJson = run.document as Record<string, unknown>;

          expect(String(errorJson['code'])).toMatch(/^MIGRATION\.CONTRACT_SPACE/);
          const meta = errorJson['meta'] as
            | { violations?: Array<{ kind: string; spaceId: string }> }
            | undefined;
          const kinds = (meta?.violations ?? []).map((v) => v.kind);
          const spaces = (meta?.violations ?? []).map((v) => v.spaceId);
          expect(kinds).toContain('declaredButUnmigrated');
          expect(spaces).toContain('test-contract-space');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
