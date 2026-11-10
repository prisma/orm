/**
 * Without `--config`, `node migration.ts` uses the config that owns the migration: the one whose migrations directory holds the file. It tries the nearest `prisma.config.ts` above the migration, then the one in the working directory, and refuses when neither owns the file.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runMigrationPlan,
  sqlitePslConfigFixture,
  timeouts,
} from '../utils/journey-test-helpers';

const PSL = `// use prisma-8

model Profile {
  id   Int    @id
  name String
}
`;

const THROWING_CONFIG = "throw new Error('the outer prisma.config.ts was loaded');\n";

/** Writes a SQLite project into `dir` whose config, named `configName`, keeps migrations in `migrationsDir`. */
function writeProject(dir: string, migrationsDir: string, configName = 'prisma.config.ts') {
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, configName);
  const config = readFileSync(sqlitePslConfigFixture, 'utf-8')
    .replace('{{DB_PATH}}', () => join(dir, 'journey.db'))
    .replace("migrations: { dir: 'migrations' }", () => `migrations: { dir: '${migrationsDir}' }`);
  writeFileSync(configPath, config, 'utf-8');
  writeFileSync(join(dir, 'contract.prisma'), PSL, 'utf-8');
  writeProjectManifest(dir);
  return { testDir: dir, configPath, outputDir: dir } satisfies JourneyContext;
}

/** Emits the contract, plans the first migration, and returns the migration's directory. */
async function planFirstMigration(ctx: JourneyContext, appDir: string): Promise<string> {
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `emit: ${emitted.stderr}`).toBe(0);
  const planned = await runMigrationPlan(ctx, ['--name', 'initial']);
  expect(planned.exitCode, `plan: ${planned.stderr}`).toBe(0);
  const [dir] = readdirSync(appDir).filter((name) => name !== 'refs');
  return join(appDir, String(dir));
}

function runNode(args: readonly string[], cwd: string) {
  const run = spawnSync(process.execPath, args, { cwd, encoding: 'utf-8' });
  return { exitCode: run.status, stdout: run.stdout, stderr: run.stderr };
}

const WROTE = { exitCode: 0, stdout: expect.stringContaining('Wrote ops.json + migration.json') };

withTempDir(({ createTempDir }) => {
  describe('node migration.ts', () => {
    it(
      'finds the config from the migration directory, the project directory and its parent',
      async () => {
        const ctx = writeProject(createTempDir(), './db/migrations');
        const migrationDir = await planFirstMigration(ctx, join(ctx.testDir, 'db/migrations/app'));
        const file = join(migrationDir, 'migration.ts');

        expect(
          runNode(['migration.ts'], migrationDir),
          'from the migration directory',
        ).toMatchObject(WROTE);
        expect(
          runNode([relative(ctx.testDir, file)], ctx.testDir),
          'from the project directory',
        ).toMatchObject(WROTE);
        const parent = dirname(ctx.testDir);
        expect(runNode([relative(parent, file)], parent), 'from the parent').toMatchObject(WROTE);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'uses the working directory config when the migrations directory is outside the project',
      async () => {
        const root = createTempDir();
        writeFileSync(join(root, 'prisma.config.ts'), THROWING_CONFIG, 'utf-8');
        const ctx = writeProject(join(root, 'app'), '../shared-db/migrations');
        const migrationDir = await planFirstMigration(ctx, join(root, 'shared-db/migrations/app'));

        expect(
          runNode([relative(ctx.testDir, join(migrationDir, 'migration.ts'))], ctx.testDir),
          'from the project directory',
        ).toMatchObject(WROTE);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'refuses when no config it finds owns the migration, and runs with --config',
      async () => {
        const root = createTempDir();
        writeProject(root, './migrations');
        const ctx = writeProject(join(root, 'inner'), './migrations', 'prisma.sqlite.config.ts');
        const migrationDir = await planFirstMigration(ctx, join(ctx.testDir, 'migrations/app'));

        const refused = runNode(['migration.ts'], migrationDir);
        expect(refused, 'without --config').toMatchObject({
          exitCode: 1,
          stdout: '',
          stderr: expect.stringContaining('CLI.MIGRATION_CONFIG_NOT_FOUND'),
        });
        expect(refused.stderr, 'names the config it checked').toContain(
          join(root, 'prisma.config.ts'),
        );
        expect(
          runNode(
            ['migration.ts', '--config', relative(migrationDir, ctx.configPath)],
            migrationDir,
          ),
          'with --config',
        ).toMatchObject(WROTE);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
