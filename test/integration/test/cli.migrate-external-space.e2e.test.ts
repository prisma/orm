/**
 * `migrate` with an all-external contract space (the Supabase shape):
 * the space pins a head ref but ships zero migration packages, so there
 * is nothing to author and nothing to replay — migrate must advance the
 * space's marker to its head declaratively (mirroring the db-init
 * aggregate planner) instead of demanding an authored graph.
 *
 * The first journey also locks AC8 of the contract-snapshot-store dedup:
 * the seed phase (run as part of `migration plan`) populates
 * `migrations/snapshots/<hex>/contract.json` for the external space's
 * head hash instead of a per-space `migrations/<space-id>/contract.json`
 * sibling, and the subsequent `migrate` — which must resolve the head
 * contract to verify/advance the marker — only succeeds by reading it
 * back through that same store entry (the aggregate loader has no other
 * source for an extension space's contract under the new layout).
 *
 * Also locks the remediation contract for the case that legitimately
 * remains unreachable (an APP space that was never planned): the error's
 * `fix` must prescribe commands that run verbatim — the test executes
 * them and expects migrate to succeed afterwards.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { storageHashHex } from '@internal/framework-components/control';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  TEST_EXTERNAL_HEAD_HASH,
  TEST_EXTERNAL_SPACE_ID,
} from './contract-space-fixture/external-space';
import {
  type EngineRunResult,
  runMigrationFile,
  runOnEngine,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';

interface Project {
  readonly testDir: string;
  readonly configPath: string;
}

async function emitContract(project: Project): Promise<void> {
  const run = await runOnEngine(project, ['contract', 'emit', '--no-color']);
  expect(run.exitCode, `contract emit failed:\n${run.stderr}`).toBe(0);
}

function getLatestMigrationDir(testDir: string): string | undefined {
  const migrationsDir = join(testDir, 'migrations', 'app');
  const dirs = readdirSync(migrationsDir).filter((d) => {
    if (d.startsWith('.')) return false;
    if (d === 'refs') return false;
    return statSync(join(migrationsDir, d)).isDirectory();
  });
  if (dirs.length === 0) return undefined;
  let newest = dirs[0]!;
  let newestMtime = statSync(join(migrationsDir, newest)).mtimeMs;
  for (let i = 1; i < dirs.length; i++) {
    const dir = dirs[i]!;
    const mtime = statSync(join(migrationsDir, dir)).mtimeMs;
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newest = dir;
    }
  }
  return newest;
}

async function selfEmitLatestMigration(testDir: string): Promise<void> {
  const latest = getLatestMigrationDir(testDir);
  if (!latest) return;
  const migrationTs = join(testDir, 'migrations', 'app', latest, 'migration.ts');
  const emitted = await runMigrationFile(migrationTs, [], testDir);
  if (emitted.exitCode !== 0) {
    throw new Error(`migration.ts self-emit failed (exit ${emitted.exitCode}): ${emitted.stderr}`);
  }
}

async function runMigrationPlan(
  project: Project,
  args: readonly string[],
): Promise<EngineRunResult> {
  const run = await runOnEngine(project, ['migration', 'plan', ...args]);
  if (run.exitCode === 0) {
    await selfEmitLatestMigration(project.testDir);
  }
  return run;
}

/** The engine settles failures into the exit code instead of throwing. */
function runMigrate(project: Project, args: readonly string[]): Promise<EngineRunResult> {
  return runOnEngine(project, ['db', 'migrate', ...args]);
}

withTempDir(({ createTempDir }) => {
  describe('migrate with an all-external contract space (e2e)', () => {
    it(
      'a fresh database migrates: app ops apply and the external space marker advances to its head',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = setupTestDirectoryFromFixtures(
            createTempDir,
            'migrate-external-space',
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          await emitContract(project);
          // Seeds the external space's pinned artifacts (head ref, no
          // bundles) and authors the app baseline bundle.
          const plan = await runMigrationPlan(project, ['--name', 'initial', '--no-color']);
          expect(plan.exitCode, `migration plan failed:\n${plan.stderr}`).toBe(0);

          // AC8: the seed phase populates the content-addressed store for
          // the external space's head, not a per-space sibling copy.
          const storeContractPath = join(
            project.testDir,
            'migrations',
            'snapshots',
            storageHashHex(TEST_EXTERNAL_HEAD_HASH),
            'contract.json',
          );
          expect(existsSync(storeContractPath)).toBe(true);
          const storedContract = JSON.parse(readFileSync(storeContractPath, 'utf-8')) as {
            storage: { storageHash: string };
          };
          expect(storedContract.storage.storageHash).toBe(TEST_EXTERNAL_HEAD_HASH);
          expect(
            existsSync(
              join(project.testDir, 'migrations', TEST_EXTERNAL_SPACE_ID, 'contract.json'),
            ),
          ).toBe(false);

          // The aggregate loader must resolve the external space's head
          // contract through that same store entry: `migrate` verifies
          // and advances the marker against it below, with no other
          // contract source available under the new layout.
          const apply = await runMigrate(project, ['--json']);
          expect(apply.exitCode, `migrate failed:\n${apply.stderr}`).toBe(0);
          expect(apply.presented?.data).toMatchObject({ ok: true });

          // The external space's marker advanced to its head ref with zero DDL.
          await withClient(connectionString, async (client) => {
            const result = await client.query(
              'SELECT core_hash FROM prisma_contract.marker WHERE space = $1',
              [TEST_EXTERNAL_SPACE_ID],
            );
            expect(result.rows.length).toBe(1);
            expect(result.rows[0]?.core_hash).toBe(TEST_EXTERNAL_HEAD_HASH);
          });

          // Idempotency: a second run reports up to date and succeeds.
          const second = await runMigrate(project, ['--json']);
          expect(second.exitCode).toBe(0);
          expect(second.presented?.data).toMatchObject({
            ok: true,
            summary: expect.stringContaining('Already up to date'),
          });
        });
      },
      timeouts.spinUpPpgDev * 2,
    );

    it(
      'a never-planned APP space still errors, and the printed remediation runs verbatim',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = setupTestDirectoryFromFixtures(
            createTempDir,
            'migration-apply',
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );

          await emitContract(project);
          // No `migration plan` — the app space has no on-disk graph.

          const failed = await runMigrate(project, ['--json']);
          expect(failed.exitCode).not.toBe(0);

          const terminal = failed.json.at(-1);
          const envelope =
            terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
          expect(envelope).toMatchObject({
            ok: false,
            error: { meta: { kind: 'neverPlanned', spaceId: 'app' } },
          });
          // The remediation must not prescribe a hash the planner cannot
          // resolve (an empty graph has no nodes to resolve hashes against),
          // and its first two run-command actions must be exactly the
          // plan-then-apply commands asserted here — if the presented actions
          // drift, this parse-and-execute round fails rather than silently
          // running hard-coded commands.
          const remediationCommands = (envelope?.nextActions ?? [])
            .filter((action) => action.kind === 'run-command')
            .map((action) => action.command)
            .slice(0, 2);
          for (const command of remediationCommands) {
            expect(command).not.toMatch(/--to [0-9a-f]{64}/);
          }
          expect(remediationCommands).toEqual([
            '{bin} migration plan --name <slug>',
            '{bin} db migrate',
          ]);

          // Execute the presented remediation: derive each command's argv from
          // the action text itself, substituting the <slug> placeholder.
          const [planCommand, migrateCommand] = remediationCommands;
          const planArgs = (planCommand ?? '')
            .replace(/^\{bin\} migration plan\s*/, '')
            .replaceAll('<slug>', 'initial')
            .split(/\s+/)
            .filter((arg) => arg.length > 0);
          const plan = await runMigrationPlan(project, [...planArgs, '--no-color']);
          expect(plan.exitCode).toBe(0);

          const migrateArgs = (migrateCommand ?? '')
            .replace(/^\{bin\} db migrate\s*/, '')
            .split(/\s+/)
            .filter((arg) => arg.length > 0);
          const apply = await runMigrate(project, [...migrateArgs, '--json']);
          expect(apply.exitCode).toBe(0);
          expect(apply.presented?.data).toMatchObject({ ok: true });
        });
      },
      timeouts.spinUpPpgDev * 2,
    );
  });
});
