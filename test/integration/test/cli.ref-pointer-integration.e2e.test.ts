import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';
import {
  type EngineCommandResult,
  getLatestMigrationDir,
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runOnEngine,
} from './utils/journey-test-helpers';

const fixtureSubdir = 'migration-apply';
const HASH_FLOAT = `${'f'.repeat(64)}`;

function appRefsDir(testDir: string): string {
  return join(testDir, 'migrations', 'app', 'refs');
}

function refPointerPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

function refPointerHash(refsDir: string, name: string): string | undefined {
  const pointerPath = refPointerPath(refsDir, name);
  if (!existsSync(pointerPath)) return undefined;
  return (JSON.parse(readFileSync(pointerPath, 'utf-8')) as { hash: string }).hash;
}

function storeContractJsonPath(testDir: string, refsDir: string, name: string): string {
  const hash = refPointerHash(refsDir, name);
  if (hash === undefined) throw new Error(`ref "${name}" has no pointer`);
  return join(contractSnapshotDir(join(testDir, 'migrations'), hash), 'contract.json');
}

// A ref now consists of just its pointer file; the contract bytes resolve
// through the content-addressed store keyed by the pointer's hash.
function refFilesExist(testDir: string, refsDir: string, name: string): boolean {
  const hash = refPointerHash(refsDir, name);
  if (hash === undefined) return false;
  const storeDir = contractSnapshotDir(join(testDir, 'migrations'), hash);
  return existsSync(join(storeDir, 'contract.json')) && existsSync(join(storeDir, 'contract.d.ts'));
}

function refFilesAbsent(refsDir: string, name: string): boolean {
  return !existsSync(refPointerPath(refsDir, name));
}

async function seedPlannedMigration(
  createTempDir: () => string,
  connectionString: string,
): Promise<{ ctx: JourneyContext; migrationDir: string; toHash: string }> {
  const { testDir, configPath } = setupTestDirectoryFromFixtures(
    createTempDir,
    fixtureSubdir,
    'prisma.config.with-db.ts',
    { '{{DB_URL}}': connectionString },
  );
  const ctx = { testDir, configPath, outputDir: join(testDir, 'output') };
  const emit = await runContractEmit(ctx);
  if (emit.exitCode !== 0) {
    throw new Error(`seedPlannedMigration: contract emit exited ${emit.exitCode}\n${emit.stderr}`);
  }
  const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'initial', '--no-color']);
  if (plan.exitCode !== 0) {
    throw new Error(`seedPlannedMigration: migration plan exited ${plan.exitCode}\n${plan.stderr}`);
  }
  const migrationDir = getLatestMigrationDir(ctx)!;
  const manifest = JSON.parse(
    readFileSync(join(testDir, 'migrations', 'app', migrationDir, 'migration.json'), 'utf-8'),
  ) as { to: string };
  return { ctx, migrationDir, toHash: manifest.to };
}

withTempDir(({ createTempDir }) => {
  describe('ref pointer integration (e2e)', () => {
    /**
     * The ref commands run on the engine, so the step is driven through the
     * engine's own harness with the project directory passed as `cwd` — no
     * chdir, no console capture.
     */
    async function runRef(
      ctx: JourneyContext,
      args: readonly string[],
    ): Promise<EngineCommandResult> {
      return runOnEngine(ctx, ['migration', 'ref', ...args]);
    }

    it(
      'ref set writes only the pointer, ref list lists it, ref delete removes the pointer but leaves the store entry',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { ctx, toHash } = await seedPlannedMigration(createTempDir, connectionString);
          const { testDir } = ctx;
          const refsDir = appRefsDir(testDir);
          const bundleEndContract = join(
            contractSnapshotDir(join(testDir, 'migrations'), toHash),
            'contract.json',
          );

          const setResult = await runRef(ctx, ['set', 'staging', toHash]);
          expect(setResult.exitCode, 'ref set exit code').toBe(0);
          expect(refFilesExist(testDir, refsDir, 'staging')).toBe(true);
          expect(
            JSON.parse(readFileSync(storeContractJsonPath(testDir, refsDir, 'staging'), 'utf-8')),
          ).toEqual(JSON.parse(readFileSync(bundleEndContract, 'utf-8')));

          const listResult = await runRef(ctx, ['list']);
          expect(listResult.exitCode, 'ref list exit code').toBe(0);
          expect(stripAnsi(listResult.stderr), 'ref list draws the table for the reader').toContain(
            'staging',
          );
          expect(listResult.stdout, 'ref list writes nothing to stdout').toBe('');
          expect(readdirSync(refsDir).filter((name) => name.endsWith('.json'))).toEqual([
            'staging.json',
          ]);

          const deleteResult = await runRef(ctx, ['delete', 'staging']);
          expect(deleteResult.exitCode, 'ref delete exit code').toBe(0);
          expect(refFilesAbsent(refsDir, 'staging')).toBe(true);
          expect(existsSync(bundleEndContract)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses a hash that is not in the migration graph',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { ctx } = await seedPlannedMigration(createTempDir, connectionString);

          const result = await runRef(ctx, ['set', 'staging', HASH_FLOAT, '--json']);
          expect(result.exitCode, 'ref set exit code').toBe(2);
          expect(result.json.at(-1)).toMatchObject({
            kind: 'result',
            envelope: {
              ok: false,
              error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH', meta: { resolvedHash: HASH_FLOAT } },
            },
          });
          expect(refFilesAbsent(appRefsDir(ctx.testDir), 'staging')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses the empty-database sentinel hash',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { ctx } = await seedPlannedMigration(createTempDir, connectionString);

          const result = await runRef(ctx, ['set', 'staging', EMPTY_CONTRACT_HASH]);
          expect(result.exitCode, 'ref set exit code').toBe(2);
          expect(stripAnsi(result.stderr), 'names the sentinel it refused').toContain(
            'empty-database sentinel',
          );
          expect(refFilesAbsent(appRefsDir(ctx.testDir), 'staging')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
