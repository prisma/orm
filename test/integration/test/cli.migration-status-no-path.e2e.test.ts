import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  appMigrationsDir,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbSign,
  runDbUpdate,
  runMigrate,
  runMigrationStatus,
  runOnEngine,
  runRef,
  setupJourney,
  sql,
  swapContract,
} from './utils/journey-test-helpers';

interface StatusJson {
  readonly summary: string;
}

async function statusSummary(ctx: JourneyContext, args: readonly string[] = []): Promise<string> {
  const status = await runMigrationStatus(ctx, [...args, '--json']);
  expect(status.exitCode, status.stderr).toBe(0);
  return parseJsonOutput<StatusJson>(status).summary;
}

/**
 * The arguments the summary's `migration plan` command gives the command, with `<name>` filled in
 * and `<contract>` replaced by `from`.
 */
function advisedPlanArgs(summary: string, from?: string): string[] {
  const command = [...summary.matchAll(/`([^`]*)`/g)]
    .map((match) => match[1] ?? '')
    .find((quoted) => quoted.startsWith('{bin} migration plan '));
  expect(command, `the summary names a \`migration plan\` command: ${summary}`).toBeDefined();
  return command!
    .slice('{bin} migration plan '.length)
    .split(/\s+/)
    .map((arg) =>
      arg === '<name>' ? 'planned-as-advised' : arg === '<contract>' && from ? from : arg,
    );
}

async function planAsAdvised(
  ctx: JourneyContext,
  summary: string,
  extra: readonly string[] = [],
  from?: string,
) {
  const plan = await planMigrationAndSelfEmit(ctx, [...advisedPlanArgs(summary, from), ...extra]);
  expect(plan.exitCode, plan.stderr).toBe(0);
}

async function planned(ctx: JourneyContext, args: readonly string[]): Promise<string> {
  const plan = await planMigrationAndSelfEmit(ctx, [...args, '--json']);
  expect(plan.exitCode, plan.stderr).toBe(0);
  return parseJsonOutput<{ to: string }>(plan).to;
}

async function emit(ctx: JourneyContext, variant: Parameters<typeof swapContract>[1]) {
  swapContract(ctx, variant);
  expect((await runContractEmit(ctx)).exitCode).toBe(0);
}

/** The summary prints no `migration plan`, says why, and each command it prints runs. */
async function expectNoPlanAndRunnableCommands(ctx: JourneyContext, summary: string) {
  expect(summary).toContain('No migration plan can author one.');
  const commands = [...summary.matchAll(/`\{bin\} ([^`]*)`/g)].map((match) =>
    (match[1] ?? '').split(/\s+/),
  );
  expect(commands.map((words) => words.slice(0, 2).join(' '))).toEqual(['migration list']);
  for (const words of commands) {
    const run = await runOnEngine(ctx, words);
    expect(run.exitCode, run.stderr).toBe(0);
  }
}

withTempDir(({ createTempDir }) => {
  describe('migration status with no path to the target names a migration plan that runs', () => {
    const inJourney = (fn: (ctx: JourneyContext) => Promise<void>) => () =>
      withDevDatabase(({ connectionString }) =>
        fn(setupJourney({ connectionString, createTempDir })),
      );

    it(
      'when db migrate applied the history without advancing a db ref',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        await planned(ctx, ['--name', 'initial']);
        expect((await runMigrate(ctx)).exitCode).toBe(0);
        await emit(ctx, 'contract-additive');

        await planAsAdvised(ctx, await statusSummary(ctx));

        expect((await runMigrate(ctx)).exitCode).toBe(0);
        expect(await statusSummary(ctx)).toBe('Up to date');
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'when the history has two tips and no db ref',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const initial = await planned(ctx, ['--name', 'initial']);
        expect((await runMigrate(ctx)).exitCode).toBe(0);
        await emit(ctx, 'contract-phone');
        const phone = await planned(ctx, ['--from', initial, '--name', 'add-phone']);
        await emit(ctx, 'contract-bio');
        const bio = await planned(ctx, ['--from', initial, '--name', 'add-bio']);
        await emit(ctx, 'contract-additive');

        const summary = await statusSummary(ctx);
        expect(summary).toContain(
          `has more than one end, so replace <contract> with one of \`${phone}\`, \`${bio}\``,
        );
        await planAsAdvised(ctx, summary, ['--delete', 'User.bio'], bio);

        expect((await runMigrate(ctx)).exitCode).toBe(0);
        expect(await statusSummary(ctx)).toBe('Up to date');
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'when the database is behind its history, extends the history instead of forking it',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const initial = await planned(ctx, ['--name', 'initial']);
        expect((await runMigrate(ctx)).exitCode).toBe(0);
        await emit(ctx, 'contract-additive');
        const addName = await planned(ctx, ['--from', initial, '--name', 'add-name']);
        await emit(ctx, 'contract-v3');

        const summary = await statusSummary(ctx);
        expect(advisedPlanArgs(summary)).toEqual([
          '--from',
          addName,
          '--name',
          'planned-as-advised',
        ]);
        await planAsAdvised(ctx, summary);

        expect((await runMigrate(ctx)).exitCode).toBe(0);
        expect(await statusSummary(ctx)).toBe('Up to date');
        const froms = getMigrationDirs(ctx).map(
          (dir) =>
            (
              JSON.parse(
                readFileSync(join(appMigrationsDir(ctx), dir, 'migration.json'), 'utf-8'),
              ) as { readonly from: string }
            ).from,
        );
        expect(froms.filter((from) => from === initial)).toHaveLength(1);
        expect(froms.filter((from) => from === addName)).toHaveLength(1);
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'when a rollback brought the database back, plans from where it is',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const initial = await planned(ctx, ['--name', 'initial']);
        await emit(ctx, 'contract-additive');
        const addName = await planned(ctx, ['--from', initial, '--name', 'add-name']);
        expect((await runMigrate(ctx)).exitCode).toBe(0);
        await planned(ctx, [
          '--from',
          addName,
          '--to',
          `${latestMigrationDirName(ctx)}^`,
          '--name',
          'drop-name',
          '--delete',
          'User.name',
        ]);
        expect((await runMigrate(ctx, ['--to', initial])).exitCode).toBe(0);
        await emit(ctx, 'contract-phone');

        const summary = await statusSummary(ctx);
        expect(advisedPlanArgs(summary)).toEqual([
          '--from',
          initial,
          '--name',
          'planned-as-advised',
        ]);
        await planAsAdvised(ctx, summary);

        expect((await runMigrate(ctx)).exitCode).toBe(0);
        expect(await statusSummary(ctx)).toBe('Up to date');
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'when the database is empty and no db ref names an origin',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        await planned(ctx, ['--name', 'initial']);
        await emit(ctx, 'contract-additive');

        await planAsAdvised(ctx, await statusSummary(ctx));

        expect((await runMigrate(ctx)).exitCode).toBe(0);
        expect(await statusSummary(ctx)).toBe('Up to date');
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'when --to names a ref no migration reaches from the database',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const initial = await planned(ctx, ['--name', 'initial']);
        await emit(ctx, 'contract-additive');
        await planned(ctx, ['--name', 'add-name', '--from', initial]);
        expect((await runMigrate(ctx)).exitCode).toBe(0);
        expect((await runRef(ctx, ['set', 'production', initial])).exitCode).toBe(0);

        const summary = await statusSummary(ctx, ['--to', 'production']);
        await planAsAdvised(ctx, summary, ['--delete', 'User.name']);

        expect((await runMigrate(ctx, ['--to', 'production'])).exitCode).toBe(0);
        expect(await statusSummary(ctx, ['--to', 'production'])).toBe('Up to date');
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'prints none, and says why, when --from names a ref no migration records',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const initial = await planned(ctx, ['--name', 'initial']);
        expect((await runMigrate(ctx)).exitCode).toBe(0);
        await emit(ctx, 'contract-additive');
        expect((await runDbUpdate(ctx)).exitCode).toBe(0);

        const summary = await statusSummary(ctx, ['--from', 'db', '--to', initial]);
        await expectNoPlanAndRunnableCommands(ctx, summary);
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'prints none, and says why, for --to @empty',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        await planned(ctx, ['--name', 'initial']);
        expect((await runMigrate(ctx)).exitCode).toBe(0);

        await expectNoPlanAndRunnableCommands(ctx, await statusSummary(ctx, ['--to', '@empty']));
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'with no migrations, prints the plan that authors the first, which runs',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const summary = await statusSummary(ctx);
        expect(summary).toBe(
          'No migrations found. Run `{bin} migration plan --from @empty --name <name>` to author the first. The database has no marker, so a plan from `@empty` fits only an empty database. A database that is not empty needs adopting first: emit the contract that describes it as it is, before your change, and record it with `{bin} db sign`, then plan from there.',
        );
        await planAsAdvised(ctx, summary);
        expect((await runMigrate(ctx)).exitCode).toBe(0);
        expect(await statusSummary(ctx)).toBe('Up to date');
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'with no migrations and a database with tables but no marker, names db sign, which leads to a plan that runs',
      () =>
        withDevDatabase(async ({ connectionString }) => {
          const ctx = setupJourney({ connectionString, createTempDir });
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          await sql(
            connectionString,
            'create table "user" (id int4 primary key, email text not null)',
          );

          const summary = await statusSummary(ctx);
          expect(summary).toContain(
            'A database that is not empty needs adopting first: emit the contract that describes it as it is, before your change, and record it with `{bin} db sign`',
          );
          const sign = await runDbSign(ctx);
          expect(sign.exitCode, sign.stderr).toBe(0);
          await emit(ctx, 'contract-additive');

          const afterSign = await statusSummary(ctx);
          expect(afterSign).toContain('No migrations found. Run `{bin} migration plan --from db');
          await planAsAdvised(ctx, afterSign);
          expect((await runMigrate(ctx)).exitCode).toBe(0);
          expect(await statusSummary(ctx)).toBe('Up to date');
        }),
      timeouts.spinUpPpgDev,
    );

    it(
      'with no migrations and --to a ref, prints the plan that ends at the ref, which runs',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        expect((await runDbUpdate(ctx)).exitCode).toBe(0);
        const production = await runDbUpdate(ctx, ['--advance-ref', 'production']);
        expect(production.exitCode, production.stderr).toBe(0);
        await emit(ctx, 'contract-additive');
        expect((await runDbUpdate(ctx)).exitCode).toBe(0);
        await emit(ctx, 'contract-v3');

        const summary = await statusSummary(ctx, ['--to', 'production']);
        expect(advisedPlanArgs(summary)).toEqual([
          '--from',
          'db',
          '--to',
          'production',
          '--name',
          'planned-as-advised',
        ]);
        await planAsAdvised(ctx, summary, ['--delete', 'User.name']);

        expect((await runMigrate(ctx, ['--to', 'production'])).exitCode).toBe(0);
        expect(await statusSummary(ctx, ['--to', 'production'])).toBe('Up to date');
      }),
      timeouts.spinUpPpgDev,
    );

    it(
      'with no migrations and a db ref, prints the plan from the db ref, which runs',
      inJourney(async (ctx) => {
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        expect((await runDbUpdate(ctx)).exitCode).toBe(0);
        await emit(ctx, 'contract-additive');
        const summary = await statusSummary(ctx);
        expect(summary).toContain('No migrations found. Run `{bin} migration plan --from db');
        await planAsAdvised(ctx, summary);
      }),
      timeouts.spinUpPpgDev,
    );
  });
});
