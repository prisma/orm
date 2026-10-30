/**
 * Variant statements on Postgres.
 *
 * `Task` is stored in table `task` and discriminated by `type`, with a check on the variants' values. `Bug` and `Epic` are its variants. In the shared layout both are stored in `task`, `Bug` with its own column `severity`; in the own-table layout each has its own table, whose foreign key to `task` cascades.
 *
 * - P1: the discriminator value of `Bug` changes from `bug` to `defect`. Without a statement the change is refused, offering `--convert Bug` first and `--delete Bug` second; `--convert Bug` rewrites the rows.
 * - P2: `Bug` is renamed to `Defect`, whose value is `defect`: `--rename Bug:Defect` rewrites the rows.
 * - P3: the value changes and `--delete Bug` deletes the rows that held it.
 * - P4: `Bug` is removed from the own-table layout: `--delete Bug` deletes its base rows, the cascade deletes its table's rows, and its table is dropped.
 * - P5: `Bug` is removed from the shared layout: `--delete Bug` deletes its rows and drops its column.
 * - P6: `Bug`, with no fields of its own, is removed: `--delete Bug` deletes its rows.
 *
 * Every journey runs twice: through `migration plan` and `migrate`, whose `migration.ts` is run again and reproduces its `ops.json`, and through `db update`. Each reads the rows back, shows the new discriminator check accepts the value the contract names and refuses the one it dropped, and ends with `db verify --schema-only` clean and a further plan empty.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
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

type Via = 'migrate' | 'db update';
const VIAS: readonly Via[] = ['migrate', 'db update'];

interface Variant {
  readonly name: string;
  readonly value: string;
  readonly field?: string;
}

function taskContract(variants: readonly Variant[], ownTables: boolean): string {
  const models = variants.map(
    ({ name, value, field }) => `
model ${name} {
${field === undefined ? '' : `  ${field} String?\n`}  @@base(Task, "${value}")
${ownTables ? `  @@map("${name.toLowerCase()}")\n` : ''}}
`,
  );
  return `// use prisma-8

model Task {
  id   Int    @id
  type String
  @@discriminator(type)
  @@map("task")
}
${models.join('')}`;
}

const BUG: Variant = { name: 'Bug', value: 'bug', field: 'severity' };
const EPIC: Variant = { name: 'Epic', value: 'epic', field: 'scope' };

const SHARED = taskContract([BUG, EPIC], false);
const CHANGED = taskContract([{ ...BUG, value: 'defect' }, EPIC], false);
const RENAMED = taskContract([{ ...BUG, name: 'Defect', value: 'defect' }, EPIC], false);
const SHARED_REMOVED = taskContract([EPIC], false);
const OWN_TABLES = taskContract([BUG, EPIC], true);
const OWN_TABLES_REMOVED = taskContract([EPIC], true);
const WITHOUT_FIELDS = taskContract([{ name: 'Bug', value: 'bug' }, EPIC], false);

const SEED_SHARED = `INSERT INTO "task" (id, type, severity) VALUES (1, 'bug', 'high'), (2, 'epic', NULL), (3, 'bug', NULL)`;
const SEED_WITHOUT_FIELDS = `INSERT INTO "task" (id, type) VALUES (1, 'bug'), (2, 'epic'), (3, 'bug')`;

async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

function journey(db: { readonly connectionString: string }, createTempDir: () => string) {
  return setupJourney({
    connectionString: db.connectionString,
    createTempDir,
    contractMode: 'psl',
  });
}

function fromLatest(ctx: JourneyContext): readonly string[] {
  return getMigrationDirs(ctx).length === 0 ? [] : ['--from', latestMigrationDirName(ctx)];
}

/** Applies the emitted contract through `via`, with the statements given, and checks a written `migration.ts` reproduces its `ops.json`. */
async function apply(
  ctx: JourneyContext,
  via: Via,
  statements: readonly string[],
  label: string,
): Promise<void> {
  if (via === 'db update') {
    const update = await runDbUpdate(ctx, [...statements, '--no-interactive', '--json']);
    expect(update.exitCode, `${label}: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
    return;
  }
  const plan = await runMigrationPlan(ctx, [
    ...fromLatest(ctx),
    '--name',
    label.replace(/\W/g, '-'),
    ...statements,
    '--json',
  ]);
  expect(plan.exitCode, `${label}: plan: ${plan.stderr}`).toBe(0);
  const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
  const ops = readFileSync(join(dir, 'ops.json'), 'utf-8');
  const reEmit = await selfEmitMigration(ctx, ['--dir', dir]);
  expect(reEmit.exitCode, `${label}: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
  expect(readFileSync(join(dir, 'ops.json'), 'utf-8'), `${label}: same ops.json`).toBe(ops);
  const migrate = await runMigrate(ctx, ['--json']);
  expect(migrate.exitCode, `${label}: migrate: ${JSON.stringify(engineError(migrate))}`).toBe(0);
}

/** The text of the refusal of the emitted contract without statements. */
async function refusal(ctx: JourneyContext, via: Via, label: string): Promise<string> {
  const refused =
    via === 'db update'
      ? await runDbUpdate(ctx, ['--no-interactive', '--json'])
      : await runMigrationPlan(ctx, [...fromLatest(ctx), '--name', 'refused', '--json']);
  expect(refused.exitCode, `${label}: refused without a statement`).not.toBe(0);
  return JSON.stringify(engineError(refused));
}

async function expectSettled(ctx: JourneyContext, via: Via, label: string): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  if (via === 'migrate') {
    const fresh = await runMigrationPlan(ctx, [...fromLatest(ctx), '--json']);
    expect(fresh.exitCode, `${label}: plan with no change: ${fresh.stderr}`).toBe(0);
    expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, `${label}: plan is empty`).toBe(true);
    return;
  }
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly unknown[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}

async function rows(connectionString: string, query: string): Promise<readonly unknown[]> {
  return (await sql(connectionString, query)).rows;
}

async function tasks(connectionString: string): Promise<readonly unknown[]> {
  return rows(connectionString, 'SELECT id, type FROM "task" ORDER BY id');
}

async function columns(connectionString: string, table: string): Promise<readonly unknown[]> {
  return (
    await rows(
      connectionString,
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY column_name`,
    )
  ).map((row) => Reflect.get(Object(row), 'column_name'));
}

async function tables(connectionString: string): Promise<readonly unknown[]> {
  return (
    await rows(
      connectionString,
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    )
  ).map((row) => Reflect.get(Object(row), 'table_name'));
}

async function insertError(connectionString: string, query: string): Promise<string> {
  try {
    await sql(connectionString, query);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'the insert was accepted';
}

/** The discriminator check accepts `accepted` and refuses `refused`, inside a transaction it rolls back. */
async function expectDiscriminatorCheck(
  connectionString: string,
  accepted: string,
  refused: string,
  label: string,
): Promise<void> {
  const { rows: checks } = await sql(
    connectionString,
    `SELECT conname FROM pg_constraint WHERE conrelid = 'public.task'::regclass AND contype = 'c'`,
  );
  const names = checks.map((row) => String(row['conname']));
  expect(names, `${label}: one discriminator check`).toEqual([
    expect.stringMatching(/^task_type_check_[0-9a-f]{8}$/),
  ]);
  await sql(connectionString, `INSERT INTO "task" (id, type) VALUES (100, '${accepted}')`);
  await sql(connectionString, 'DELETE FROM "task" WHERE id = 100');
  expect(
    await insertError(connectionString, `INSERT INTO "task" (id, type) VALUES (100, '${refused}')`),
    `${label}: the check refuses "${refused}"`,
  ).toContain(`violates check constraint "${names[0]}"`);
}

withTempDir(({ createTempDir }) => {
  describe.each(VIAS)('P1 (%s): convert a variant whose discriminator value changed', (via) => {
    const db = useDevDatabase();

    it(
      'is refused offering --convert Bug then --delete Bug, and --convert Bug rewrites the rows',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, SHARED, 'P1.01');
        await apply(ctx, via, [], 'P1.02');
        await sql(db.connectionString, SEED_SHARED);
        await emit(ctx, CHANGED, 'P1.03');

        const offered = await refusal(ctx, via, 'P1.04');
        expect(offered, 'P1.04: convert offered').toContain('--convert Bug');
        expect(offered, 'P1.04: delete offered').toContain('--delete Bug');
        expect(offered.indexOf('--convert Bug'), 'P1.04: convert first').toBeLessThan(
          offered.indexOf('--delete Bug'),
        );

        await apply(ctx, via, ['--convert', 'Bug'], 'P1.05');
        expect(await tasks(db.connectionString), 'P1.05: the rows hold the new value').toEqual([
          { id: 1, type: 'defect' },
          { id: 2, type: 'epic' },
          { id: 3, type: 'defect' },
        ]);
        await expectDiscriminatorCheck(db.connectionString, 'defect', 'bug', 'P1.06');
        await expectSettled(ctx, via, 'P1.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('P2 (%s): rename a variant and its discriminator value', (via) => {
    const db = useDevDatabase();

    it(
      '--rename Bug:Defect rewrites the rows to the new value',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, SHARED, 'P2.01');
        await apply(ctx, via, [], 'P2.02');
        await sql(db.connectionString, SEED_SHARED);
        await emit(ctx, RENAMED, 'P2.03');

        await apply(ctx, via, ['--rename', 'Bug:Defect'], 'P2.04');
        expect(
          await rows(db.connectionString, 'SELECT id, type, severity FROM "task" ORDER BY id'),
          'P2.04: the rows hold the new value and keep their columns',
        ).toEqual([
          { id: 1, type: 'defect', severity: 'high' },
          { id: 2, type: 'epic', severity: null },
          { id: 3, type: 'defect', severity: null },
        ]);
        await expectDiscriminatorCheck(db.connectionString, 'defect', 'bug', 'P2.05');
        await expectSettled(ctx, via, 'P2.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('P3 (%s): delete the rows of a variant whose value changed', (via) => {
    const db = useDevDatabase();

    it(
      '--delete Bug deletes the rows that held the old value',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, SHARED, 'P3.01');
        await apply(ctx, via, [], 'P3.02');
        await sql(db.connectionString, SEED_SHARED);
        await emit(ctx, CHANGED, 'P3.03');

        await apply(ctx, via, ['--delete', 'Bug'], 'P3.04');
        expect(await tasks(db.connectionString), 'P3.04: only the other variant is left').toEqual([
          { id: 2, type: 'epic' },
        ]);
        await expectDiscriminatorCheck(db.connectionString, 'defect', 'bug', 'P3.05');
        await expectSettled(ctx, via, 'P3.06');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('P4 (%s): remove a variant stored in its own table', (via) => {
    const db = useDevDatabase();

    it(
      'asks one question about Bug, and --delete Bug deletes its rows and drops its table',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, OWN_TABLES, 'P4.01');
        await apply(ctx, via, [], 'P4.02');
        await sql(
          db.connectionString,
          `INSERT INTO "task" (id, type) VALUES (1, 'bug'), (2, 'epic'), (3, 'bug')`,
        );
        await sql(
          db.connectionString,
          `INSERT INTO "bug" (id, severity) VALUES (1, 'high'), (3, NULL)`,
        );
        await sql(db.connectionString, `INSERT INTO "epic" (id, scope) VALUES (2, 'all')`);
        await emit(ctx, OWN_TABLES_REMOVED, 'P4.03');

        const offered = await refusal(ctx, via, 'P4.04');
        expect(offered, 'P4.04: one statement for the model').toContain('--delete Bug');
        expect(offered, 'P4.04: no question per field').not.toContain('Bug.severity');

        await apply(ctx, via, ['--delete', 'Bug'], 'P4.05');
        expect(await tasks(db.connectionString), 'P4.05: its base rows are deleted').toEqual([
          { id: 2, type: 'epic' },
        ]);
        expect(await tables(db.connectionString), 'P4.05: its table is dropped').not.toContain(
          'bug',
        );
        expect(
          await rows(db.connectionString, 'SELECT id, scope FROM "epic"'),
          'P4.05: the other variant keeps its rows',
        ).toEqual([{ id: 2, scope: 'all' }]);
        await expectDiscriminatorCheck(db.connectionString, 'epic', 'bug', 'P4.06');
        await expectSettled(ctx, via, 'P4.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('P5 (%s): remove a variant stored in its base table', (via) => {
    const db = useDevDatabase();

    it(
      '--delete Bug deletes its rows and drops its column',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, SHARED, 'P5.01');
        await apply(ctx, via, [], 'P5.02');
        await sql(db.connectionString, SEED_SHARED);
        await emit(ctx, SHARED_REMOVED, 'P5.03');

        const offered = await refusal(ctx, via, 'P5.04');
        expect(offered, 'P5.04: one statement for the model').toContain('--delete Bug');
        expect(offered, 'P5.04: no question per field').not.toContain('Bug.severity');

        await apply(ctx, via, ['--delete', 'Bug'], 'P5.05');
        expect(await tasks(db.connectionString), 'P5.05: its rows are deleted').toEqual([
          { id: 2, type: 'epic' },
        ]);
        expect(await columns(db.connectionString, 'task'), 'P5.05: its column is dropped').toEqual([
          'id',
          'scope',
          'type',
        ]);
        await expectDiscriminatorCheck(db.connectionString, 'epic', 'bug', 'P5.06');
        await expectSettled(ctx, via, 'P5.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe.each(VIAS)('P6 (%s): remove a variant with no columns of its own', (via) => {
    const db = useDevDatabase();

    it(
      '--delete Bug deletes its rows',
      async () => {
        const ctx = journey(db, createTempDir);
        await emit(ctx, WITHOUT_FIELDS, 'P6.01');
        await apply(ctx, via, [], 'P6.02');
        await sql(db.connectionString, SEED_WITHOUT_FIELDS);
        await emit(ctx, SHARED_REMOVED, 'P6.03');

        expect(await refusal(ctx, via, 'P6.04'), 'P6.04: asked about the model').toContain(
          '--delete Bug',
        );

        await apply(ctx, via, ['--delete', 'Bug'], 'P6.05');
        expect(await tasks(db.connectionString), 'P6.05: its rows are deleted').toEqual([
          { id: 2, type: 'epic' },
        ]);
        expect(await columns(db.connectionString, 'task'), 'P6.05: no column dropped').toEqual([
          'id',
          'scope',
          'type',
        ]);
        await expectDiscriminatorCheck(db.connectionString, 'epic', 'bug', 'P6.06');
        await expectSettled(ctx, via, 'P6.07');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
