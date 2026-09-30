/**
 * Journey: the `migration.ts` that `migration plan` writes, run with `node migration.ts`, writes the
 * same `ops.json` as the plan, reading each column default with the column's codec. A default the
 * codec refuses, written into the file by hand, stops the run with the contract error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  runContractEmit,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  timeouts,
} from '../utils/journey-test-helpers';

const SQLITE_CONFIG_TEMPLATE = join(
  __dirname,
  '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/prisma.config.sqlite.psl.ts',
);

function sqliteJourney(createTempDir: () => string): JourneyContext {
  const ctx = setupJourney({ createTempDir, contractMode: 'psl' });
  writeFileSync(
    ctx.configPath,
    readFileSync(SQLITE_CONFIG_TEMPLATE, 'utf-8').replace('{{DB_PATH}}', () =>
      join(ctx.testDir, 'test.db'),
    ),
    'utf-8',
  );
  return ctx;
}

function writeSchema(ctx: JourneyContext, schema: string): void {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), `// use prisma-8\n\n${schema}`, 'utf-8');
}

async function emitAndPlan(ctx: JourneyContext, name: string): Promise<string> {
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, stripAnsi(emit.stderr)).toBe(0);
  const plan = await runMigrationPlan(ctx, ['--name', name]);
  expect(plan.exitCode, stripAnsi(plan.stderr)).toBe(0);
  const dir = getLatestMigrationDir(ctx);
  if (dir === undefined) throw new Error('migration plan wrote no migration package');
  return join(ctx.testDir, 'migrations', 'app', dir);
}

function editMigrationTs(packageDir: string, from: string, to: string): void {
  const path = join(packageDir, 'migration.ts');
  const source = readFileSync(path, 'utf-8');
  expect(source.split(from)).toHaveLength(2);
  writeFileSync(path, source.replace(from, to), 'utf-8');
}

async function runMigrationTs(ctx: JourneyContext, packageDir: string) {
  const run = await selfEmitMigration(ctx, ['--dir', packageDir]);
  return { exitCode: run.exitCode, firstErrorLine: stripAnsi(run.stderr).split('\n')[0] };
}

const NEW_TABLE = `model Note {
  id  Int      @id
  big BigInt   @default(9007199254740993)
  at  DateTime @default("2020-01-01T00:00:00Z")
}
`;

withTempDir(({ createTempDir }) => {
  describe('Journey: column defaults in a migration.ts', () => {
    it(
      'a SQLite new table: the planned migration.ts writes the ops.json the plan wrote',
      async () => {
        const ctx = sqliteJourney(createTempDir);
        writeSchema(ctx, NEW_TABLE);
        const packageDir = await emitAndPlan(ctx, 'init');
        const planned = readFileSync(join(packageDir, 'ops.json'), 'utf-8');

        const run = await runMigrationTs(ctx, packageDir);

        expect(run.exitCode, run.firstErrorLine).toBe(0);
        expect(readFileSync(join(packageDir, 'ops.json'), 'utf-8')).toBe(planned);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a SQLite new table: a default the codec refuses stops the migration.ts with the contract error',
      async () => {
        const ctx = sqliteJourney(createTempDir);
        writeSchema(ctx, NEW_TABLE);
        const packageDir = await emitAndPlan(ctx, 'init');
        editMigrationTs(packageDir, "lit('2020-01-01T00:00:00Z')", "lit('not a date')");

        expect(await runMigrationTs(ctx, packageDir)).toEqual({
          exitCode: 1,
          firstErrorLine:
            'CONTRACT.DEFAULT_INVALID: Column "Note"."at" has a default its codec sqlite/datetime@1 refuses: sqlite/datetime@1 JSON value must be a date and time string',
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
