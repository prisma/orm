import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runMigrationNew,
  runMigrationPlan,
  setupJourney,
  timeouts,
} from '../utils/journey-test-helpers';

// The import-root lints read any quoted package name after `from` as an import, so names are built from constants.
const CONFIG_MODULE = '@acme/orm-db/migration';
const WORKSPACE = '@internal/postgres';
const WORKSPACE_MODULE = `module: '${WORKSPACE}/migration',`;
const SPECIFIER = /\bfrom\s*['"]([^'"\n]+)['"]/g;

function packageImports(source: string): string[] {
  return [...new Set([...source.matchAll(SPECIFIER)].map(([, specifier]) => specifier ?? ''))]
    .filter((specifier) => !specifier.startsWith('.'))
    .sort();
}

function rewriteConfig(ctx: JourneyContext, replacement: string): void {
  const config = readFileSync(ctx.configPath, 'utf-8');
  expect(config).toContain(WORKSPACE_MODULE);
  writeFileSync(ctx.configPath, config.replace(WORKSPACE_MODULE, replacement));
}

function appMigrationsDir(ctx: JourneyContext): string {
  return join(ctx.testDir, 'migrations', 'app');
}

function writtenMigrationTs(ctx: JourneyContext): string {
  const [dirName, ...rest] = readdirSync(appMigrationsDir(ctx)).filter(
    (entry) => !entry.startsWith('.') && entry !== 'refs',
  );
  expect(rest, 'expected exactly one migration package').toEqual([]);
  return readFileSync(join(appMigrationsDir(ctx), dirName ?? '', 'migration.ts'), 'utf-8');
}

async function emitContract(ctx: JourneyContext): Promise<void> {
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `contract emit: ${emit.stderr}`).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('Journey: a written migration.ts imports from the config’s migration module', () => {
    it(
      'scaffolds an empty migration that imports from the module the config names',
      async () => {
        const ctx = setupJourney({ createTempDir });
        rewriteConfig(ctx, `module: '${CONFIG_MODULE}',`);
        await emitContract(ctx);

        const scaffold = await runMigrationNew(ctx, ['--name', 'empty']);

        expect(scaffold.exitCode, `migration new: ${scaffold.stderr}`).toBe(0);
        expect(packageImports(writtenMigrationTs(ctx))).toEqual([CONFIG_MODULE]);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'plans a migration that imports from the module the config names',
      async () => {
        const ctx = setupJourney({ createTempDir });
        rewriteConfig(ctx, `module: '${CONFIG_MODULE}',`);
        await emitContract(ctx);

        const planned = await runMigrationPlan(ctx, ['--name', 'initial']);

        expect(planned.exitCode, `migration plan: ${planned.stderr}`).toBe(0);
        expect(packageImports(writtenMigrationTs(ctx))).toEqual([CONFIG_MODULE]);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      'refuses to scaffold or plan with no migration module, writing nothing',
      async () => {
        const ctx = setupJourney({ createTempDir });
        rewriteConfig(ctx, '');
        await emitContract(ctx);

        for (const run of [
          await runMigrationNew(ctx, ['--name', 'refused', '--json']),
          await runMigrationPlan(ctx, ['--name', 'refused', '--json']),
        ]) {
          expect(run.exitCode).toBe(2);
          expect(parseJsonOutput(run)).toMatchObject({ code: 'CONFIG.MIGRATION_MODULE_MISSING' });
        }
        expect(existsSync(appMigrationsDir(ctx))).toBe(false);
      },
      timeouts.typeScriptCompilation,
    );

    it(
      "writes the module a target package's defineConfig names, as the missing-module error advises",
      async () => {
        const ctx = setupJourney({ createTempDir });
        writeFileSync(
          ctx.configPath,
          [
            `import { defineConfig } from '${WORKSPACE}/config';`,
            "import { definePrismaConfig } from '@prisma/cli-engine';",
            '',
            "export default definePrismaConfig({ orm: defineConfig({ contract: './contract.ts', output: 'output' }) });",
            '',
          ].join('\n'),
        );
        await emitContract(ctx);

        const scaffold = await runMigrationNew(ctx, ['--name', 'facade']);

        expect(scaffold.exitCode, `migration new: ${scaffold.stderr}`).toBe(0);
        expect(packageImports(writtenMigrationTs(ctx))).toEqual([`${WORKSPACE}/migration`]);
      },
      timeouts.typeScriptCompilation,
    );
  });
});
