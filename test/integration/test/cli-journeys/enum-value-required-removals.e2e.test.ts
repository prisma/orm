/**
 * Removing an enum value that a required column types, on Postgres.
 *
 * `Task` has a required `status` and a list `tags`, both typed by `Status`, whose `ARCHIVED` member stores `archived`. The destination contract drops `ARCHIVED`, or renames it to `RETIRED`, which stores `retired`.
 *
 * In E4 no row holds the value, and `--delete` removes it. In E5 rows hold it: the question offers the rename first, `--delete` fails at apply with `MIGRATION.PRECHECK_FAILED` saying how to keep the rows and changes nothing, and `--rename` applies. E6 follows the advice of `db update` and sets the rows to another value. E7 and E8 follow the two pieces of advice of a failed `db migrate`: edit the written `migration.ts`, or plan again with a rename.
 *
 * Every journey ends with `db verify --schema-only` clean and `db update --dry-run` planning nothing.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { contractWith, emit, expectSettled, tasks } from '../utils/enum-value-journeys';
import {
  engineError,
  type JourneyContext,
  latestMigrationDirName,
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
import { followEdits } from '../utils/stored-value-edits';

function requiredContractWith(members: string): string {
  return contractWith(members).replace('status Status?', 'status Status ');
}

const REQUIRED_FROM_PSL = requiredContractWith('  ARCHIVED = "archived"\n');
const REQUIRED_REMOVED_PSL = requiredContractWith('');
const REQUIRED_RENAMED_PSL = requiredContractWith('  RETIRED = "retired"\n');

/** The contract hash a migration directory ends at, as advice prints it. */
function originHash(ctx: JourneyContext, dirName: string): string {
  const migration = JSON.parse(
    readFileSync(join(ctx.testDir, 'migrations', 'app', dirName, 'migration.json'), 'utf-8'),
  ) as { to: string };
  return migration.to.replace(/^sha256:/, '');
}

function nextActionLabels(result: Parameters<typeof engineError>[0]): readonly string[] {
  return (engineError(result)?.nextActions ?? []).map(({ label }) => label);
}

/** The failure of a removal while one row of the required column holds the stored value. */
function expectRowsHoldingFailure(result: Parameters<typeof engineError>[0], label: string): void {
  const error = engineError(result);
  expect(
    {
      code: error?.code,
      summary: error?.summary,
      why: error?.why,
      description: (error?.meta as { failedCheck?: { description?: string } } | undefined)
        ?.failedCheck?.description,
    },
    label,
  ).toEqual({
    code: 'MIGRATION.PRECHECK_FAILED',
    summary:
      '1 row of "task" holds "archived" in column "status", which takes no NULL, so the value cannot be removed.',
    why: 'Operation removeStoredValue.task.status.archived failed during precheck: ensure column "status" of "task" takes NULL, or no row holds "archived" in it. The failed apply changed nothing.',
    description: 'ensure column "status" of "task" takes NULL, or no row holds "archived" in it',
  });
  expect(JSON.stringify(error?.nextActions ?? []), label).not.toContain('drifted');
}

async function requiredStart(
  db: { readonly connectionString: string },
  createTempDir: () => string,
  label: string,
): Promise<JourneyContext> {
  const ctx = setupJourney({
    connectionString: db.connectionString,
    createTempDir,
    contractMode: 'psl',
  });
  await emit(ctx, REQUIRED_FROM_PSL, `${label}.01`);
  const create = await runDbUpdate(ctx, ['--json']);
  expect(create.exitCode, `${label}.02: db update creates the table: ${create.stderr}`).toBe(0);
  return ctx;
}

withTempDir(({ createTempDir }) => {
  describe('E4: delete an enum value a required column types, when no row holds it', () => {
    const db = useDevDatabase();

    it(
      'removes the value when no row holds it',
      async () => {
        const ctx = await requiredStart(db, createTempDir, 'E4');
        await sql(
          db.connectionString,
          `INSERT INTO "task" (id, status, tags) VALUES (1, 'active', '{}')`,
        );
        await emit(ctx, REQUIRED_REMOVED_PSL, 'E4.03');

        const update = await runDbUpdate(ctx, [
          '--delete',
          'Status.ARCHIVED',
          '--no-interactive',
          '--json',
        ]);
        expect(update.exitCode, `E4.04: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
        await expectSettled(ctx, 'E4.05');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('E5: delete an enum value a required column types, while rows hold it', () => {
    const db = useDevDatabase();

    it(
      'asks with rename first, fails at apply on --delete, and applies a rename',
      async () => {
        const ctx = await requiredStart(db, createTempDir, 'E5');
        await sql(
          db.connectionString,
          `INSERT INTO "task" (id, status, tags) VALUES (1, 'archived', '{}'), (2, 'active', '{}')`,
        );
        await emit(ctx, REQUIRED_REMOVED_PSL, 'E5.03');

        const asked = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(engineError(asked)?.code, 'E5.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        const actions = JSON.stringify(engineError(asked)?.nextActions ?? []);
        expect(actions, 'E5.04: the rename is offered').toContain(
          "--rename 'Status.ARCHIVED:Status.<new name>'",
        );
        expect(
          actions.indexOf("--rename 'Status.ARCHIVED"),
          'E5.04: the rename comes before the delete',
        ).toBeLessThan(actions.indexOf('--delete Status.ARCHIVED'));

        const deleted = await runDbUpdate(ctx, [
          '--delete',
          'Status.ARCHIVED',
          '--no-interactive',
          '--json',
        ]);
        expect(deleted.exitCode, 'E5.05: the removal fails at apply').not.toBe(0);
        expectRowsHoldingFailure(deleted, 'E5.05');
        expect(nextActionLabels(deleted), 'E5.05: one action per way out').toEqual([
          'To keep that data under a new enum value, add a member to enum "Status" in the contract source, run `prisma-test contract emit`, then run `prisma-test db update --rename \'Status.ARCHIVED:Status.<new member>\'`',
          expect.stringMatching(
            /^To keep that data by hand, plan the change with `prisma-test migration plan --from db --delete Status\.ARCHIVED`, make the edits below/,
          ),
        ]);
        const advised = await runMigrationPlan(ctx, [
          '--from',
          'db',
          '--delete',
          'Status.ARCHIVED',
          '--name',
          'as-advised',
        ]);
        expect(advised.exitCode, `E5.05: the advised plan runs: ${advised.stderr}`).toBe(0);
        expect(await tasks(db.connectionString), 'E5.05: nothing changed').toEqual([
          { id: 1, status: 'archived', tags: [] },
          { id: 2, status: 'active', tags: [] },
        ]);

        await emit(ctx, REQUIRED_RENAMED_PSL, 'E5.06');
        const renamed = await runDbUpdate(ctx, [
          '--rename',
          'Status.ARCHIVED:Status.RETIRED',
          '--no-interactive',
          '--json',
        ]);
        expect(renamed.exitCode, `E5.07: db update: ${JSON.stringify(engineError(renamed))}`).toBe(
          0,
        );
        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: 'retired', tags: [] },
          { id: 2, status: 'active', tags: [] },
        ]);
        await expectSettled(ctx, 'E5.08');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('E6: keep the rows of a required column by setting another value, as db update advises', () => {
    const db = useDevDatabase();

    it(
      'removes the value once the rows hold another one',
      async () => {
        const ctx = await requiredStart(db, createTempDir, 'E6');
        await sql(
          db.connectionString,
          `INSERT INTO "task" (id, status, tags) VALUES (1, 'archived', '{}'), (2, 'active', '{}')`,
        );
        await emit(ctx, REQUIRED_REMOVED_PSL, 'E6.03');
        const failed = await runDbUpdate(ctx, [
          '--delete',
          'Status.ARCHIVED',
          '--no-interactive',
          '--json',
        ]);
        expectRowsHoldingFailure(failed, 'E6.04');

        await sql(
          db.connectionString,
          `UPDATE "task" SET status = 'active' WHERE status = 'archived'`,
        );
        const update = await runDbUpdate(ctx, [
          '--delete',
          'Status.ARCHIVED',
          '--no-interactive',
          '--json',
        ]);
        expect(update.exitCode, `E6.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: 'active', tags: [] },
          { id: 2, status: 'active', tags: [] },
        ]);
        await expectSettled(ctx, 'E6.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  /** A migrated project whose next migration removes `ARCHIVED` while a row of the required column holds it. */
  async function failedMigration(
    db: { readonly connectionString: string },
    label: string,
  ): Promise<{
    readonly ctx: JourneyContext;
    readonly origin: string;
    readonly failed: Awaited<ReturnType<typeof runMigrate>>;
  }> {
    const ctx = setupJourney({
      connectionString: db.connectionString,
      createTempDir,
      contractMode: 'psl',
    });
    await emit(ctx, REQUIRED_FROM_PSL, `${label}.01`);
    const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    expect((await runMigrate(ctx)).exitCode, `${label}.02: migrate initial`).toBe(0);
    const origin = latestMigrationDirName(ctx);
    await sql(
      db.connectionString,
      `INSERT INTO "task" (id, status, tags) VALUES (1, 'archived', '{}'), (2, 'active', '{}')`,
    );
    await emit(ctx, REQUIRED_REMOVED_PSL, `${label}.03`);
    const plan = await runMigrationPlan(ctx, [
      '--name',
      'retire',
      '--from',
      origin,
      '--delete',
      'Status.ARCHIVED',
      '--json',
    ]);
    expect(plan.exitCode, `${label}.04: plan: ${plan.stderr}`).toBe(0);
    const failed = await runMigrate(ctx, ['--json']);
    expect(failed.exitCode, `${label}.05: migrate fails`).not.toBe(0);
    expectRowsHoldingFailure(failed, `${label}.05`);
    return { ctx, origin, failed };
  }

  describe('E7: keep the rows of a required column by hand in migration.ts, as db migrate advises', () => {
    const db = useDevDatabase();

    it(
      'replaces the removal with a replacement in the written migration.ts, runs it, and migrates',
      async () => {
        const { ctx, failed } = await failedMigration(db, 'E7');
        const dirName = latestMigrationDirName(ctx);
        const byHand = nextActionLabels(failed)[1] ?? '';
        expect(byHand).toBe(
          [
            `To keep that data by hand, make the edits below in \`migrations/app/${dirName}/migration.ts\`, where <stored value> is a stored value the enum keeps, run \`node migrations/app/${dirName}/migration.ts\`, and re-run \`prisma-test db migrate\`.`,
            'Replace:',
            'this.removeStoredValue({',
            "        schema: 'public',",
            "        table: 'task',",
            "        column: 'status',",
            "        value: 'archived',",
            "        codecRef: { codecId: 'pg/text@1' },",
            "        enumValue: { namespaceId: 'public', enum: 'Status', member: 'ARCHIVED' },",
            '      })',
            'with:',
            'this.replaceStoredValue({',
            "        schema: 'public',",
            "        table: 'task',",
            "        column: 'status',",
            "        from: 'archived',",
            "        to: '<stored value>',",
            "        codecRef: { codecId: 'pg/text@1' },",
            '      })',
          ].join('\n'),
        );

        const file = join(ctx.testDir, 'migrations', 'app', dirName, 'migration.ts');
        writeFileSync(
          file,
          followEdits(
            readFileSync(file, 'utf-8'),
            byHand.replaceAll("'<stored value>'", "'active'"),
          ),
        );
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `E7.07: node migration.ts: ${reEmit.stderr}`).toBe(0);
        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `E7.08: migrate: ${migrate.stderr}`).toBe(0);

        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: 'active', tags: [] },
          { id: 2, status: 'active', tags: [] },
        ]);
        await expectSettled(ctx, 'E7.09');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('E8: keep the rows of a required column under a new member, as db migrate advises', () => {
    const db = useDevDatabase();

    it(
      'deletes the written migration, plans it again with a rename, and migrates',
      async () => {
        const { ctx, origin, failed } = await failedMigration(db, 'E8');
        const dirName = latestMigrationDirName(ctx);
        const rename = nextActionLabels(failed)[0] ?? '';
        expect(rename).toBe(
          `To keep that data under a new enum value, add a member to enum "Status" in the contract source, run \`prisma-test contract emit\`, delete \`migrations/app/${dirName}\` (copy any code you wrote in its migration.ts first), plan it again with \`prisma-test migration plan --from ${originHash(ctx, origin)} --name retire --rename 'Status.ARCHIVED:Status.<new member>'\`, adding any other statements you planned it with except any \`--delete Status.ARCHIVED\`, put any code you copied into the migration.ts it writes, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`prisma-test db migrate\``,
        );
        const printedFrom = /--from (\S+)/.exec(rename)?.[1] ?? '';

        await emit(ctx, REQUIRED_RENAMED_PSL, 'E8.06');
        rmSync(join(ctx.testDir, 'migrations', 'app', dirName), { recursive: true });
        const plan = await planMigrationAndSelfEmit(ctx, [
          '--from',
          printedFrom,
          '--name',
          'retire',
          '--rename',
          'Status.ARCHIVED:Status.RETIRED',
        ]);
        expect(plan.exitCode, `E8.07: plan again: ${plan.stderr}`).toBe(0);
        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `E8.08: migrate: ${migrate.stderr}`).toBe(0);

        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: 'retired', tags: [] },
          { id: 2, status: 'active', tags: [] },
        ]);
        await expectSettled(ctx, 'E8.09');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
