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
  runMigrationStatus,
  runOnEngine,
  runRef,
  setupJourney,
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

/** The arguments the summary's `migration plan` command gives the command, with `<name>` filled in. */
function advisedPlanArgs(summary: string): string[] {
  const command = [...summary.matchAll(/`([^`]*)`/g)]
    .map((match) => match[1] ?? '')
    .find((quoted) => quoted.startsWith('{bin} migration plan '));
  expect(command, `the summary names a \`migration plan\` command: ${summary}`).toBeDefined();
  return command!
    .slice('{bin} migration plan '.length)
    .split(/\s+/)
    .map((arg) => (arg === '<name>' ? 'planned-as-advised' : arg));
}

async function planAsAdvised(ctx: JourneyContext, summary: string, extra: readonly string[] = []) {
  const plan = await planMigrationAndSelfEmit(ctx, [...advisedPlanArgs(summary), ...extra]);
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
        await planned(ctx, ['--from', initial, '--name', 'add-phone']);
        await emit(ctx, 'contract-bio');
        await planned(ctx, ['--from', initial, '--name', 'add-bio']);
        await emit(ctx, 'contract-additive');

        await planAsAdvised(ctx, await statusSummary(ctx));

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
  });
});
