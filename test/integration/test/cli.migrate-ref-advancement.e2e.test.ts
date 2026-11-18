import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  type EngineRunResult,
  runMigrationFile,
  runOnEngine,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';
import { replaceInFileOrThrow } from './utils/contract-fixture-editing';

const fixtureSubdir = 'migration-apply';

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

async function runMigrationPlan(project: Project, args: readonly string[]): Promise<void> {
  const run = await runOnEngine(project, ['migration', 'plan', ...args]);
  expect(run.exitCode, `migration plan failed:\n${run.stderr}`).toBe(0);
  await selfEmitLatestMigration(project.testDir);
}

async function runMigrate(project: Project, args: readonly string[]): Promise<EngineRunResult> {
  const run = await runOnEngine(project, ['db', 'migrate', ...args]);
  expect(run.exitCode, `migrate failed:\n${run.stderr}`).toBe(0);
  return run;
}

/** The engine settles failures into the exit code instead of throwing. */
function runMigrateAllowFailure(
  project: Project,
  args: readonly string[],
): Promise<EngineRunResult> {
  return runOnEngine(project, ['db', 'migrate', ...args]);
}

function appRefsDir(testDir: string): string {
  return join(testDir, 'migrations/app/refs');
}

function refPointerPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

function migrationsDirFromRefsDir(refsDir: string): string {
  return dirname(dirname(refsDir));
}

function refPointerHash(refsDir: string, name: string): string | undefined {
  const pointerPath = refPointerPath(refsDir, name);
  if (!existsSync(pointerPath)) return undefined;
  return (JSON.parse(readFileSync(pointerPath, 'utf-8')) as { hash: string }).hash;
}

function storeContractJsonPath(refsDir: string, name: string): string {
  const hash = refPointerHash(refsDir, name);
  if (hash === undefined) throw new Error(`ref "${name}" has no pointer`);
  return join(contractSnapshotDir(migrationsDirFromRefsDir(refsDir), hash), 'contract.json');
}

// A ref now consists of just its pointer file; the contract bytes resolve
// through the content-addressed store keyed by the pointer's hash.
function refFilesExist(refsDir: string, name: string): boolean {
  const hash = refPointerHash(refsDir, name);
  if (hash === undefined) return false;
  const storeDir = contractSnapshotDir(migrationsDirFromRefsDir(refsDir), hash);
  return existsSync(join(storeDir, 'contract.json')) && existsSync(join(storeDir, 'contract.d.ts'));
}

function refFilesAbsent(refsDir: string, name: string): boolean {
  return !existsSync(refPointerPath(refsDir, name));
}

function noRefFilesUnder(refsDir: string): boolean {
  if (!existsSync(refsDir)) return true;
  return readdirSync(refsDir).length === 0;
}

async function seedPlannedMigration(
  createTempDir: () => string,
  connectionString: string,
): Promise<{
  testDir: string;
  configPath: string;
  migrationDir: string;
  toHash: string;
  contractPath: string;
}> {
  const project = setupTestDirectoryFromFixtures(
    createTempDir,
    fixtureSubdir,
    'prisma.config.with-db.ts',
    {
      '{{DB_URL}}': connectionString,
    },
  );
  await emitContract(project);
  await runMigrationPlan(project, ['--name', 'initial', '--no-color']);
  const migrationDir = getLatestMigrationDir(project.testDir)!;
  const manifest = JSON.parse(
    readFileSync(
      join(project.testDir, 'migrations', 'app', migrationDir, 'migration.json'),
      'utf-8',
    ),
  ) as { to: string };
  return {
    testDir: project.testDir,
    configPath: project.configPath,
    migrationDir,
    toHash: manifest.to,
    contractPath: project.contractPath,
  };
}

withTempDir(({ createTempDir }) => {
  describe('migrate ref advancement (e2e)', () => {
    it(
      'does not advance any ref without --advance-ref',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          await runMigrate(project, ['--no-color']);

          expect(noRefFilesUnder(refsDir)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'advances an explicit ref on the default database',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          await runMigrate(project, ['--advance-ref', 'staging', '--no-color']);

          expect(refFilesExist(refsDir, 'staging')).toBe(true);
          expect(refFilesAbsent(refsDir, 'db')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'does not advance any ref with --to when --advance-ref is omitted',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          await runMigrate(project, ['--no-color']);
          await runMigrate(project, ['--to', project.migrationDir, '--no-color']);

          expect(noRefFilesUnder(refsDir)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'advances an explicit ref with --to using the bundle contract snapshot',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);
          const bundleEndContract = join(
            contractSnapshotDir(join(project.testDir, 'migrations'), project.toHash),
            'contract.json',
          );

          await runMigrate(project, ['--no-color']);
          await runMigrate(project, [
            '--to',
            project.migrationDir,
            '--advance-ref',
            'staging',
            '--no-color',
          ]);

          expect(refFilesExist(refsDir, 'staging')).toBe(true);
          expect(
            JSON.parse(readFileSync(storeContractJsonPath(refsDir, 'staging'), 'utf-8')),
          ).toEqual(JSON.parse(readFileSync(bundleEndContract, 'utf-8')));
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'does not implicitly advance db on the default database',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          await runMigrate(project, ['--no-color']);

          expect(refFilesAbsent(refsDir, 'db')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'advances an explicit ref when --db is provided',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          await runMigrate(project, [
            '--db',
            connectionString,
            '--advance-ref',
            'staging',
            '--no-color',
          ]);

          expect(refFilesExist(refsDir, 'staging')).toBe(true);
          expect(refFilesAbsent(refsDir, 'db')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes advancedRef in JSON apply output',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);

          const run = await runMigrate(project, ['--advance-ref', 'staging', '--json']);

          expect(run.presented?.data).toMatchObject({
            advancedRef: { name: 'staging', hash: expect.any(String) },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'writes ref on no-op apply when --advance-ref is provided',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          await runMigrate(project, ['--no-color']);
          await runMigrate(project, ['--advance-ref', 'staging', '--json']);

          expect(refFilesExist(refsDir, 'staging')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'idempotently rewrites the ref on repeated migrate --advance-ref',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          await runMigrate(project, ['--no-color']);

          await runMigrate(project, ['--advance-ref', 'staging', '--no-color']);
          const firstPointer = readFileSync(refPointerPath(refsDir, 'staging'), 'utf-8');
          const firstStoreContract = readFileSync(
            storeContractJsonPath(refsDir, 'staging'),
            'utf-8',
          );

          await runMigrate(project, ['--advance-ref', 'staging', '--no-color']);

          expect(readFileSync(refPointerPath(refsDir, 'staging'), 'utf-8')).toBe(firstPointer);
          expect(readFileSync(storeContractJsonPath(refsDir, 'staging'), 'utf-8')).toBe(
            firstStoreContract,
          );
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'surfaces MIGRATION.INVALID_REF_NAME for an invalid ref name',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);

          const run = await runMigrateAllowFailure(project, [
            '--advance-ref',
            'bad ref name',
            '--json',
          ]);

          expect(run.exitCode).not.toBe(0);
          expect(run.json.at(-1)).toMatchObject({
            kind: 'result',
            envelope: { ok: false, error: { code: 'MIGRATION.INVALID_REF_NAME' } },
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'does not write refs when apply fails before success',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          await runMigrate(project, ['--no-color']);

          replaceInFileOrThrow(
            project.contractPath,
            '        email: field.column(textColumn),\n',
            '        email: field.column(textColumn),\n        nickname: field.column(textColumn).optional(),\n',
          );
          await emitContract(project);

          const run = await runMigrateAllowFailure(project, ['--advance-ref', 'staging', '--json']);

          expect(run.exitCode).not.toBe(0);
          expect(refFilesAbsent(refsDir, 'staging')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'does not write refs when --to fails to resolve',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);
          const refsDir = appRefsDir(project.testDir);

          const run = await runMigrateAllowFailure(project, [
            '--to',
            'nonexistent-ref-name',
            '--advance-ref',
            'staging',
            '--json',
          ]);

          expect(run.exitCode).not.toBe(0);
          expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: false } });
          expect(refFilesAbsent(refsDir, 'staging')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports advancedRef as null when --advance-ref is not provided',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await seedPlannedMigration(createTempDir, connectionString);

          const run = await runMigrate(project, ['--json']);

          expect(run.presented?.data).toMatchObject({ advancedRef: null });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
