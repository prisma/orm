import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
  setupJourney,
  sql,
  swapContract,
} from './utils/journey-test-helpers';

interface ErrorJson {
  readonly code?: string;
  readonly why?: string;
  readonly nextActions?: readonly { readonly label: string; readonly command?: string }[];
}

/** The `migration plan` commands `text` prints in backticks, as a shell would pass their arguments. */
function printedPlans(text: string): string[][] {
  return [...text.matchAll(/`[^`\s]+ migration plan([^`]*)`/g)].map((match) =>
    (match[1] ?? '')
      .trim()
      .split(/\s+/)
      .filter((word) => word !== '')
      .map((word) => word.replace(/^'(.*)'$/, '$1')),
  );
}

/** An error's next actions as text: each command in backticks, each choice as written. */
function adviceText(error: ErrorJson): string {
  return (error.nextActions ?? [])
    .map(({ label, command }) => (command === undefined ? label : `\`${command}\``))
    .join('\n');
}

async function expectEachPlanRuns(ctx: JourneyContext, text: string, count = 1) {
  const plans = printedPlans(text);
  expect(plans, text).toHaveLength(count);
  for (const args of plans) {
    const plan = await runMigrationPlan(ctx, [...args, '--name', 'as-advised']);
    expect(plan.exitCode, `migration plan ${args.join(' ')}: ${plan.stdout}\n${plan.stderr}`).toBe(
      0,
    );
  }
}

/** A database `db migrate` moved to the base contract, with no `db` ref, holding one user. */
async function migratedWithoutDbRef(ctx: JourneyContext, connectionString: string) {
  expect((await runContractEmit(ctx)).exitCode).toBe(0);
  expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
  expect((await runMigrate(ctx)).exitCode).toBe(0);
  await sql(connectionString, `INSERT INTO "user" (id, email) VALUES (1, 'dev@example.test')`);
}

withTempDir(({ createTempDir }) => {
  describe('the migration plan db update advice prints runs', () => {
    const inJourney =
      (fn: (ctx: JourneyContext, connectionString: string) => Promise<void>) => () =>
        withDevDatabase(({ connectionString }) =>
          fn(setupJourney({ connectionString, createTempDir }), connectionString),
        );

    it(
      'in the refusal of --backfill, on a migrated database with no db ref',
      inJourney(async (ctx, connectionString) => {
        await migratedWithoutDbRef(ctx, connectionString);
        swapContract(ctx, 'contract-additive-required-name');
        expect((await runContractEmit(ctx)).exitCode).toBe(0);

        const refused = parseJsonOutput<{ readonly error?: ErrorJson } & ErrorJson>(
          await runDbUpdate(ctx, ['--backfill', 'User.name', '--json']),
        );
        const error = refused.error ?? refused;
        expect(error.code).toBe('MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE');
        await expectEachPlanRuns(ctx, adviceText(error));
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'in none for the refusal of --backfill on a database with rows and no marker, which names db sign',
      inJourney(async (ctx, connectionString) => {
        await sql(
          connectionString,
          'CREATE TABLE "user" (id int4 PRIMARY KEY, email text NOT NULL)',
        );
        await sql(
          connectionString,
          `INSERT INTO "user" (id, email) VALUES (1, 'dev@example.test')`,
        );
        swapContract(ctx, 'contract-additive-required-name');
        expect((await runContractEmit(ctx)).exitCode).toBe(0);

        const refused = parseJsonOutput<{ readonly error?: ErrorJson } & ErrorJson>(
          await runDbUpdate(ctx, ['--backfill', 'User.name', '--json']),
        );
        const error = refused.error ?? refused;
        expect(error.code).toBe('MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE');
        expect(printedPlans(adviceText(error))).toEqual([]);
        expect(error.why).toContain(
          'No migration can be planned for them either. The database has no marker, so a plan from `@empty` fits only an empty database. A database that is not empty needs adopting first: emit the contract that describes it as it is, before your change, and record it with `prisma-test db sign`, then plan from there. A plan from `@empty` creates every model, so its statements name nothing it can resolve.',
        );
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'in the temporary-value warning of a dry run, and in none after the apply',
      inJourney(async (ctx, connectionString) => {
        await migratedWithoutDbRef(ctx, connectionString);
        swapContract(ctx, 'contract-additive-required-name');
        expect((await runContractEmit(ctx)).exitCode).toBe(0);

        const dryRun = await runDbUpdate(ctx, ['--dry-run']);
        expect(dryRun.exitCode, dryRun.stderr).toBe(0);
        expect(dryRun.stdout + dryRun.stderr).toContain('temporary value');
        await expectEachPlanRuns(ctx, dryRun.stdout + dryRun.stderr);

        const applied = await runDbUpdate(ctx);
        expect(applied.exitCode, applied.stderr).toBe(0);
        expect(applied.stdout + applied.stderr).toContain(
          'To choose another value, update those rows.',
        );
        expect(printedPlans(applied.stdout + applied.stderr)).toEqual([]);
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'in the temporary-value warning of a dry run in a project with no migrations, from the db ref',
      inJourney(async (ctx, connectionString) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        expect((await runDbUpdate(ctx)).exitCode).toBe(0);
        await sql(
          connectionString,
          `INSERT INTO "user" (id, email) VALUES (1, 'dev@example.test')`,
        );
        swapContract(ctx, 'contract-additive-required-name');
        expect((await runContractEmit(ctx)).exitCode).toBe(0);

        const dryRun = await runDbUpdate(ctx, ['--dry-run']);
        expect(dryRun.exitCode, dryRun.stderr).toBe(0);
        expect(printedPlans(dryRun.stdout + dryRun.stderr)[0]?.slice(0, 2)).toEqual([
          '--from',
          'db',
        ]);
        await expectEachPlanRuns(ctx, dryRun.stdout + dryRun.stderr);
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'in the advice for rows a new required field has no value for',
      inJourney(async (ctx, connectionString) => {
        swapContract(ctx, 'contract-nullable-name');
        await migratedWithoutDbRef(ctx, connectionString);
        swapContract(ctx, 'contract-nullable-name-required');
        expect((await runContractEmit(ctx)).exitCode).toBe(0);

        const failed = await runDbUpdate(ctx, ['--json']);
        expect(failed.exitCode).not.toBe(0);
        const parsed = parseJsonOutput<{ readonly error?: ErrorJson } & ErrorJson>(failed);
        const error = parsed.error ?? parsed;
        await expectEachPlanRuns(ctx, adviceText(error));
      }),
      timeouts.spinUpPpgDev,
    );
  });
});
