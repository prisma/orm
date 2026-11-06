/**
 * Enum value statements on Postgres.
 *
 * `Task` has an optional `status` and a list `tags`, both typed by `Status`, whose `ARCHIVED` member stores `archived`. The destination contract drops `ARCHIVED`, or renames it to `RETIRED`, which stores `retired`.
 *
 * E4 and E5 have a required `status`. In E4 no row holds the value, and `--delete` removes it. In E5 rows hold it: the question offers the rename first, `--delete` fails at apply with `MIGRATION.PRECHECK_FAILED` saying how to keep the rows and changes nothing, and `--rename` applies.
 *
 * E10 swaps the stored values of `ACTIVE` and `ARCHIVED`: both are asked about, and the printed edits swap the data through a temporary value.
 *
 * E1 renames the value with `--rename Status.ARCHIVED:Status.RETIRED` through `migration plan` and `migrate`: the rows and lists that held `archived` hold `retired`. E2 deletes the value through `db update`: refused until `--delete Status.ARCHIVED` answers, then the rows hold NULL and the lists lose it. E3 renames only the member, keeping its stored value, through `db update`: nothing is planned and the statement is reported as applied.
 *
 * Every journey ends with `db verify --schema-only` clean and a further plan empty, and the `migration.ts` written is run again and reproduces its `ops.json` and `migration.json` byte for byte.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { followEdits } from '../utils/stored-value-edits';

function contractWith(members: string): string {
  return `// use prisma-8

enum Status {
  @@type("pg/text@1")
  ACTIVE = "active"
${members}}

model Task {
  id     Int      @id
  status Status?
  tags   Status[]
  @@map("task")
}
`;
}

const FROM_PSL = contractWith('  ARCHIVED = "archived"\n');
const RENAMED_PSL = contractWith('  RETIRED = "retired"\n');
const REMOVED_PSL = contractWith('');
const MEMBER_RENAMED_PSL = contractWith('  RETIRED = "archived"\n');

function twoTablesWith(archived: string): string {
  return `// use prisma-8

enum Status {
  @@type("pg/text@1")
  ACTIVE = "active"
  ARCHIVED = "${archived}"
}

model Task {
  id     Int      @id
  status Status?
  tags   Status[]
  @@map("task")
}

model Note {
  id    Int     @id
  state Status?
  @@map("note")
}
`;
}

function requiredContractWith(members: string): string {
  return contractWith(members).replace('status Status?', 'status Status ');
}

const REQUIRED_FROM_PSL = requiredContractWith('  ARCHIVED = "archived"\n');
const REQUIRED_REMOVED_PSL = requiredContractWith('');
const REQUIRED_RENAMED_PSL = requiredContractWith('  RETIRED = "retired"\n');

interface PlannedOperation {
  readonly label: string;
  readonly operationClass: string;
}

async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

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

async function tasks(connectionString: string): Promise<readonly unknown[]> {
  return (await sql(connectionString, 'SELECT id, status, tags FROM "task" ORDER BY id')).rows;
}

async function expectSettled(
  ctx: JourneyContext,
  via: 'migrate' | 'db update',
  from: string | undefined,
  label: string,
): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  if (via === 'migrate' && from !== undefined) {
    const count = getMigrationDirs(ctx).length;
    const fresh = await runMigrationPlan(ctx, ['--from', from, '--json']);
    expect(fresh.exitCode, `${label}: plan with no change: ${fresh.stderr}`).toBe(0);
    expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}: plan is empty`).toBe(true);
    expect(getMigrationDirs(ctx), `${label}: nothing written`).toHaveLength(count);
    return;
  }
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

function packageFiles(ctx: JourneyContext, dirName: string) {
  const dir = join(ctx.testDir, 'migrations', 'app', dirName);
  return {
    ops: readFileSync(join(dir, 'ops.json'), 'utf-8'),
    migration: readFileSync(join(dir, 'migration.json'), 'utf-8'),
    source: readFileSync(join(dir, 'migration.ts'), 'utf-8'),
  };
}

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
        await expectSettled(ctx, 'migrate', dirName, 'E1.07');
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
        await expectSettled(ctx, 'db update', undefined, 'E2.06');
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
        await expectSettled(ctx, 'db update', undefined, 'E4.05');
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
          'To keep that data under another stored value, change the stored value "archived" to one the enum keeps in the database yourself, then re-run `prisma-test db update --delete Status.ARCHIVED`',
        ]);
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
        await expectSettled(ctx, 'db update', undefined, 'E5.08');
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
        await expectSettled(ctx, 'db update', undefined, 'E6.06');
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
        await expectSettled(ctx, 'migrate', dirName, 'E7.09');
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
        await expectSettled(ctx, 'migrate', latestMigrationDirName(ctx), 'E8.09');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('E9: keep the data of a member that keeps its name with a new stored value, as the question advises', () => {
    const db = useDevDatabase();

    it(
      'rewrites the value in every column the enum types, two tables and a list, when the advice is followed as printed',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emit(ctx, twoTablesWith('archived'), 'E9.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `E9.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'E9.02: migrate initial').toBe(0);
        const origin = latestMigrationDirName(ctx);
        await sql(
          db.connectionString,
          `INSERT INTO "task" (id, status, tags) VALUES (1, 'archived', '{archived,active}'), (2, 'active', '{}');
           INSERT INTO "note" (id, state) VALUES (1, 'archived')`,
        );
        await emit(ctx, twoTablesWith('old'), 'E9.03');

        const asked = await runMigrationPlan(ctx, ['--from', origin, '--json']);
        expect(engineError(asked)?.code, 'E9.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(
          String(engineError(asked)?.why),
          'E9.04: the question lists every column, one per line',
        ).toBe(
          'These operations would lose enum value "Status.ARCHIVED" from the data that holds it:\n- Remove value "archived" from column "state" of "note"\n- Remove value "archived" from column "status" of "task"\n- Remove value "archived" from column "tags" of "task"',
        );
        const question = nextActionLabels(asked)[0] ?? '';
        expect(question, 'E9.04: the way that keeps the data comes first').toContain(
          'To keep that data, answer with --delete Status.ARCHIVED, then in the migration.ts this command writes replace',
        );
        expect(question, 'E9.04: names the command that runs the file').toContain(
          'run `node <migration directory>/migration.ts` for the directory it writes',
        );
        expect(
          question.match(/replace this\.removeStoredValue/g),
          'E9.04: one edit per column',
        ).toHaveLength(3);

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'keep',
          '--from',
          origin,
          '--delete',
          'Status.ARCHIVED',
        ]);
        expect(plan.exitCode, `E9.05: plan: ${plan.stderr}`).toBe(0);
        const dirName = latestMigrationDirName(ctx);
        const file = join(ctx.testDir, 'migrations', 'app', dirName, 'migration.ts');
        writeFileSync(file, followEdits(readFileSync(file, 'utf-8'), question));
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `E9.06: node migration.ts: ${reEmit.stderr}`).toBe(0);
        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `E9.07: migrate: ${migrate.stderr}`).toBe(0);

        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: 'old', tags: ['old', 'active'] },
          { id: 2, status: 'active', tags: [] },
        ]);
        expect(
          (await sql(db.connectionString, 'SELECT id, state FROM "note" ORDER BY id')).rows,
        ).toEqual([{ id: 1, state: 'old' }]);
        await expectSettled(ctx, 'migrate', dirName, 'E9.08');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('E10: keep the data of two members that swap stored values, as the question advises', () => {
    const db = useDevDatabase();

    it(
      'asks about both members and swaps the values in every column through a temporary value',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emit(ctx, twoTablesWith('archived'), 'E10.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `E10.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'E10.02: migrate initial').toBe(0);
        const origin = latestMigrationDirName(ctx);
        await sql(
          db.connectionString,
          `INSERT INTO "task" (id, status, tags) VALUES (1, 'archived', '{archived,active}'), (2, 'active', '{}');
           INSERT INTO "note" (id, state) VALUES (1, 'active')`,
        );
        await emit(
          ctx,
          twoTablesWith('active').replace('ACTIVE = "active"', 'ACTIVE = "archived"'),
          'E10.03',
        );

        const asked = await runMigrationPlan(ctx, ['--from', origin, '--json']);
        expect(engineError(asked)?.code, 'E10.04: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        const why = String(engineError(asked)?.why);
        expect(why, 'E10.04: asks about both members').toContain('"Status.ACTIVE"');
        expect(why, 'E10.04: asks about both members').toContain('"Status.ARCHIVED"');
        const question = nextActionLabels(asked).join('\n');

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'swap',
          '--from',
          origin,
          '--delete',
          'Status.ACTIVE',
          '--delete',
          'Status.ARCHIVED',
        ]);
        expect(plan.exitCode, `E10.05: plan: ${plan.stderr}`).toBe(0);
        const dirName = latestMigrationDirName(ctx);
        const file = join(ctx.testDir, 'migrations', 'app', dirName, 'migration.ts');
        writeFileSync(file, followEdits(readFileSync(file, 'utf-8'), question));
        const reEmit = await selfEmitMigration(ctx, ['--dir', `migrations/app/${dirName}`]);
        expect(reEmit.exitCode, `E10.06: node migration.ts: ${reEmit.stderr}`).toBe(0);
        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `E10.07: migrate: ${migrate.stderr}`).toBe(0);

        expect(await tasks(db.connectionString)).toEqual([
          { id: 1, status: 'active', tags: ['active', 'archived'] },
          { id: 2, status: 'archived', tags: [] },
        ]);
        expect(
          (await sql(db.connectionString, 'SELECT id, state FROM "note" ORDER BY id')).rows,
        ).toEqual([{ id: 1, state: 'archived' }]);
        await expectSettled(ctx, 'migrate', dirName, 'E10.08');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
