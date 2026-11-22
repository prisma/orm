import { describe, expect, it } from 'vitest';
import { BIN_COMMANDS } from '../../src/orm/cli';
import { dbFlag } from '../../src/orm/flags';
import {
  cliCommand,
  planAction,
  printedPlan,
  rerunFlags,
  selfEmitCommand,
} from '../../src/utils/printed-command';
import { reference } from './plan-origins';

describe('selfEmitCommand', () => {
  it('names the migration.ts relative to where the CLI ran, with the --config it was given', () => {
    expect(
      selfEmitCommand(
        { cwd: '/work', configPath: 'my app/prisma.config.ts', dbGiven: true },
        '/work/my app/migrations/app/20261013T1200_age/migration.ts',
      ),
    ).toBe(
      "node 'my app/migrations/app/20261013T1200_age/migration.ts' --config 'my app/prisma.config.ts'",
    );
  });
});

describe('cliCommand', () => {
  it('repeats --db <url> for exactly the commands whose flags include --db', () => {
    const withDb = { cwd: '/work', configPath: undefined, dbGiven: true };
    const commands = Object.entries(BIN_COMMANDS);
    expect(
      commands
        .filter(([name]) => cliCommand(withDb, name).endsWith(' --db <url>'))
        .map(([name]) => name),
    ).toEqual(
      commands
        .filter(([, command]) => Object.values(command.args?.flags ?? {}).includes(dbFlag))
        .map(([name]) => name),
    );
  });
});

describe('rerunFlags', () => {
  it.each([
    {
      flags: { to: 'production', advanceRef: 'my db', permitPolicyChange: true },
      args: ['--to', 'production', '--advance-ref', "'my db'", '--permit-policy-change'],
    },
    { flags: { to: undefined, advanceRef: undefined, permitPolicyChange: false }, args: [] },
    { flags: { to: undefined, advanceRef: undefined, permitPolicyChange: undefined }, args: [] },
  ])('repeats exactly the flags given: $args', ({ flags, args }) => {
    expect(rerunFlags(flags)).toEqual(args);
  });
});

describe('printedPlan', () => {
  const PROJECT = { cwd: '/p', configPath: undefined, dbGiven: false };

  it('prints a command that runs for a reference, quoted for a shell', () => {
    expect(
      printedPlan(PROJECT, { from: reference('db'), to: reference("it's") }, ['--name', '<name>']),
    ).toEqual({
      kind: 'runs',
      command: "{bin} migration plan --from db --to 'it'\\''s' --name <name>",
    });
  });

  it('names the candidates for a choice, and gives it as a choice, not a command', () => {
    const plan = printedPlan(
      PROJECT,
      { from: { kind: 'ambiguous', reason: 'Two ends', candidates: ['x', 'y'] } },
      [],
    );
    expect(plan).toEqual({
      kind: 'fill',
      command: '{bin} migration plan --from <contract>',
      fill: 'Two ends, so replace <contract> with one of `x`, `y`',
    });
    expect(planAction('Plan it', plan)).toEqual({
      kind: 'user-choice',
      label:
        'Plan it with `{bin} migration plan --from <contract>`. Two ends, so replace <contract> with one of `x`, `y`.',
    });
  });

  it('says what a choice takes when the candidates are unknown', () => {
    expect(
      printedPlan(PROJECT, { from: { kind: 'ambiguous', reason: 'Unread', candidates: [] } }, []),
    ).toMatchObject({
      fill: 'Unread, so replace <contract> with a contract `{bin} migration list` shows, a ref that names one, or `@empty`',
    });
  });

  it('prints no command, with every reason, when either end cannot be named', () => {
    expect(
      printedPlan(
        PROJECT,
        { from: { kind: 'none', reason: 'No start' }, to: { kind: 'none', reason: 'No end' } },
        [],
      ),
    ).toEqual({ kind: 'none', reason: 'No start. No end' });
  });
});
