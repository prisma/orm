/**
 * Enum value statements on Postgres.
 *
 * `Task` has an optional `status` and a list `tags`, both typed by `Status`, whose `ARCHIVED` member stores `archived`. The destination contract drops `ARCHIVED`, or renames it to `RETIRED`, which stores `retired`.
 *
 * E1 renames the value with `--rename Status.ARCHIVED:Status.RETIRED` through `migration plan` and `migrate`: the rows and lists that held `archived` hold `retired`. E2 deletes the value through `db update`: refused until `--delete Status.ARCHIVED` answers, then the rows hold NULL and the lists lose it. E3 renames only the member, keeping its stored value, through `db update`: nothing is planned and the statement is reported as applied.
 *
 * Removing a value that a required column types is in `enum-value-required-removals.e2e.test.ts`. A member that keeps its name while its stored value changes is in `enum-stored-values.e2e.test.ts`.
 *
 * Every journey ends with `db verify --schema-only` clean and `db update --dry-run` planning nothing, and the `migration.ts` written is run again and reproduces its `ops.json` and `migration.json` byte for byte.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  contractWith,
  emit,
  expectSettled,
  type PlannedOperation,
  tasks,
} from '../utils/enum-value-journeys';
import {
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const FROM_PSL = contractWith('  ARCHIVED = "archived"\n');
const RENAMED_PSL = contractWith('  RETIRED = "retired"\n');
const REMOVED_PSL = contractWith('');
const MEMBER_RENAMED_PSL = contractWith('  RETIRED = "archived"\n');

async function startAt(
  db: { readonly connectionString: string },
  createTempDir: () => string,
  via: 'migrate' | 'db update',
  label: string,
): Promise<{ readonly ctx: JourneyContext; readonly origin: string | undefined }> {
  const ctx = setupJourney({
    connectionString: db.connectionString,
    createTempDir,
    contractMode: 'psl',
  });
  await emit(ctx, FROM_PSL, `${label}.01`);
  if (via === 'migrate') {
    const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    const migrate = await runMigrate(ctx);
    expect(migrate.exitCode, `${label}.02: migrate initial: ${migrate.stderr}`).toBe(0);
  } else {
    const create = await runDbUpdate(ctx, ['--json']);
    expect(create.exitCode, `${label}.02: db update creates the table: ${create.stderr}`).toBe(0);
  }
  await sql(
    db.connectionString,
    `INSERT INTO "task" (id, status, tags) VALUES
       (1, 'archived', '{archived,active}'), (2, 'active', '{active}'), (3, NULL, '{}')`,
  );
  return { ctx, origin: via === 'migrate' ? latestMigrationDirName(ctx) : undefined };
}

function packageFiles(ctx: JourneyContext, dirName: string) {
  const dir = join(ctx.testDir, 'migrations', 'app', dirName);
  return {
    ops: readFileSync(join(dir, 'ops.json'), 'utf-8'),
    migration: readFileSync(join(dir, 'migration.json'), 'utf-8'),
    source: readFileSync(join(dir, 'migration.ts'), 'utf-8'),
  };
}

withTempDir(({ createTempDir }) => {
  describe('E1: rename an enum value with migration plan', () => {
    const db = useDevDatabase();

    it(
      'rewrites the rows and lists that hold the old value, and the migration reproduces itself',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'E1');
        await emit(ctx, RENAMED_PSL, 'E1.03');

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'retire',
          '--from',
          origin ?? '',
          '--rename',
          'Status.ARCHIVED:Status.RETIRED',
          '--json',
        ]);
        expect(plan.exitCode, `E1.04: plan: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<{
          operations: readonly PlannedOperation[];
          appliedStatements: readonly { description: string; operationIndexes: number[] }[];
        }>(plan);
        expect(planned.operations.map(({ label }) => label)).toEqual([
          expect.stringMatching(/^Drop check constraint "task_status_check_/),
          expect.stringMatching(/^Drop check constraint "task_tags_check_/),
          'Replace value "archived" with "retired" in column "status" of "task"',
          'Replace value "archived" with "retired" in column "tags" of "task"',
          expect.stringMatching(/^Add check constraint "task_status_check_/),
          expect.stringMatching(/^Add check constraint "task_tags_check_/),
        ]);
        expect(planned.appliedStatements).toMatchObject([
          {
            description: 'rename enum value "Status.ARCHIVED" to "Status.RETIRED"',
            operationIndexes: [2, 3],
          },
        ]);
        const dirName = latestMigrationDirName(ctx);
        const written = packageFiles(ctx, dirName);
        expect(written.source).toContain('this.replaceStoredValue(');
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `E1.05: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
        expect(packageFiles(ctx, dirName)).toEqual(written);
        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `E1.06: migrate: ${migrate.stderr}`).toBe(0);

        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: 'retired', tags: ['retired', 'active'] },
          { id: 2, status: 'active', tags: ['active'] },
          { id: 3, status: null, tags: [] },
        ]);
        await expectSettled(ctx, 'E1.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('E2: delete an enum value with db update', () => {
    const db = useDevDatabase();

    it(
      'is refused until --delete names the value, then clears it from the rows and lists',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'E2');
        await emit(ctx, REMOVED_PSL, 'E2.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(refused)?.code, 'E2.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(
          JSON.stringify(engineError(refused)?.nextActions ?? []),
          'E2.04: one flag for the value',
        ).toContain('--delete Status.ARCHIVED');

        const update = await runDbUpdate(ctx, [
          '--delete',
          'Status.ARCHIVED',
          '--no-interactive',
          '--json',
        ]);
        expect(update.exitCode, `E2.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: null, tags: ['active'] },
          { id: 2, status: 'active', tags: ['active'] },
          { id: 3, status: null, tags: [] },
        ]);
        await expectSettled(ctx, 'E2.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('E3: rename only the member with db update', () => {
    const db = useDevDatabase();

    it(
      'plans nothing for a member whose stored value stays, and reports the rename as applied',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'E3');
        await emit(ctx, MEMBER_RENAMED_PSL, 'E3.03');

        const dryRun = await runDbUpdate(ctx, [
          '--rename',
          'Status.ARCHIVED:Status.RETIRED',
          '--dry-run',
          '--json',
        ]);
        expect(dryRun.exitCode, `E3.04: dry run: ${dryRun.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(dryRun).plan
            .operations,
        ).toEqual([]);

        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: 'archived', tags: ['archived', 'active'] },
          { id: 2, status: 'active', tags: ['active'] },
          { id: 3, status: null, tags: [] },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
