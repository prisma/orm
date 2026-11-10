/**
 * A model that keeps its name while `@@map` gives it a new table (Postgres).
 *
 * The Postgres twin of `table-map-change.sqlite.e2e.test.ts`.
 *
 * No statement can rename that table, so the question about the dropped table says how to keep its rows. Journey M1 follows the `migration plan` route as printed: a migration of its own written with `migration new`, the printed `renameTable` call and the printed `node` command, then `db migrate`. Journey M2 follows the `db update` route: the printed SQL, then `db update`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type EngineCommandResult,
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  latestMigrationToHash,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationNew,
  runMigrationPlan,
  runPrintedSelfEmit,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const FROM_PSL = `// use prisma-8

model Profile {
  id   Int    @id
  name String @unique

  @@map("profiles")
}
`;

const TO_PSL = FROM_PSL.replace('@@map("profiles")', '@@map("people")');

async function emitContract(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit: ${emit.stderr}`).toBe(0);
}

function questionOf(result: EngineCommandResult): string {
  return String(engineError(result)?.why);
}

async function expectRowsKept(connectionString: string, label: string): Promise<void> {
  const rows = await sql(connectionString, 'SELECT id, name FROM "public"."people" ORDER BY id');
  const tables = await sql(
    connectionString,
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%' ORDER BY tablename",
  );
  expect(
    { rows: rows.rows, tables: tables.rows.map((row) => row['tablename']) },
    `${label}: the rows are in the renamed table`,
  ).toEqual({
    rows: [
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ],
    tables: ['people'],
  });
}

async function seedRows(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    `INSERT INTO "public"."profiles" (id, name) VALUES (1, 'alice'), (2, 'bob')`,
  );
}

withTempDir(({ createTempDir }) => {
  describe('Journey M1 (Postgres): the migration plan route keeps the rows', () => {
    const db = useDevDatabase();

    it(
      'writes the rename as a migration of its own, as the question prints it',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emitContract(ctx, FROM_PSL, 'M1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `M1.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'M1.03: migrate initial').toBe(0);
        await seedRows(db.connectionString);
        const origin = latestMigrationDirName(ctx);
        const originHash = latestMigrationToHash(ctx);
        await emitContract(ctx, TO_PSL, 'M1.04');

        const refused = await runMigrationPlan(ctx, ['--from', origin, '--json']);
        expect(refused.exitCode, 'M1.05: the drop of profiles needs a statement').toBe(2);
        const question = questionOf(refused);
        expect(question, 'M1.05: the question says how to keep the rows').toContain(
          'To keep its rows, rename table "profiles" to "people" instead',
        );

        const scaffold = await runMigrationNew(ctx, ['--name', 'people', '--from', originHash]);
        expect(scaffold.exitCode, `M1.06: migration new: ${scaffold.stderr}`).toBe(0);
        const dir = latestMigrationDirName(ctx);
        const call = /add (\.\.\.this\.renameTable\(.*?\)) to the operations/.exec(question)?.[1];
        expect(call, `M1.07: the printed renameTable call in: ${question}`).toBeDefined();
        const migrationTs = join(ctx.testDir, 'migrations/app', dir, 'migration.ts');
        const scaffolded = readFileSync(migrationTs, 'utf-8');
        const edited = scaffolded.replace(/return \[[\s\S]*?\];/, () => `return [${call}];`);
        expect(edited, 'M1.07: the call is in the operations').not.toBe(scaffolded);
        writeFileSync(migrationTs, edited, 'utf-8');
        const emitted = runPrintedSelfEmit(question, dirname(migrationTs));
        expect(emitted.exitCode, `M1.08: node on migration.ts, as printed: ${emitted.stderr}`).toBe(
          0,
        );

        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `M1.09: db migrate: ${applied.stderr}`).toBe(0);
        await expectRowsKept(db.connectionString, 'M1.10');
        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `M1.10: db verify --schema-only: ${verify.stderr}`).toBe(0);
        const further = await runMigrationPlan(ctx, ['--from', dir, '--json']);
        expect(further.exitCode, `M1.11: a further plan: ${further.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(further).noOp, 'M1.11: it is empty').toBe(true);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey M2 (Postgres): the db update route keeps the rows', () => {
    const db = useDevDatabase();

    it(
      'renames the table with the printed SQL, then db update finds nothing that loses data',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emitContract(ctx, FROM_PSL, 'M2.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `M2.02: db update creates the table: ${create.stderr}`).toBe(0);
        await seedRows(db.connectionString);
        await emitContract(ctx, TO_PSL, 'M2.03');

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(refused.exitCode, 'M2.04: the drop of profiles needs a statement').toBe(2);
        const printed = /yourself with (.*?), then run prisma db update/.exec(
          questionOf(refused),
        )?.[1];
        expect(printed, 'M2.04: the printed SQL').toBeDefined();
        await sql(db.connectionString, String(printed));

        const updated = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(updated.exitCode, `M2.05: db update: ${updated.stderr}`).toBe(0);
        await expectRowsKept(db.connectionString, 'M2.06');
        const verify = await runDbVerify(ctx, ['--schema-only']);
        expect(verify.exitCode, `M2.06: db verify --schema-only: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
