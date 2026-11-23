import type { ContractMarkerRecordLike } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import { migrationPlanForDatabase } from '../../src/control-api/operations/plan-arguments';
import { BIN_COMMANDS } from '../../src/orm/cli';
import { dbFlag } from '../../src/orm/flags';
import {
  cliCommand,
  planAction,
  printedPlan,
  printedWayToTarget,
  rerunFlags,
  selfEmitCommand,
} from '../../src/utils/printed-command';
import { buildGraph, entry } from './graph-helpers';
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
      flags: {
        to: 'production',
        advanceRef: 'my db',
        noAdvanceRef: undefined,
        permitPolicyChange: true,
      },
      args: ['--to', 'production', '--advance-ref', "'my db'", '--permit-policy-change'],
    },
    {
      flags: {
        to: undefined,
        advanceRef: undefined,
        noAdvanceRef: true,
        permitPolicyChange: false,
      },
      args: ['--no-advance-ref'],
    },
    {
      flags: {
        to: undefined,
        advanceRef: undefined,
        noAdvanceRef: false,
        permitPolicyChange: false,
      },
      args: [],
    },
    {
      flags: {
        to: undefined,
        advanceRef: undefined,
        noAdvanceRef: undefined,
        permitPolicyChange: undefined,
      },
      args: [],
    },
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

  it('prints no plan from @empty for a statement written as --<verb>=<value>', () => {
    expect(
      printedPlan(undefined, { from: { kind: 'reference', reference: '@empty' } }, [
        '--delete=-legacy',
      ]),
    ).toMatchObject({ kind: 'none' });
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

describe('printedWayToTarget', () => {
  const PROJECT = { cwd: '/p', configPath: undefined, dbGiven: true };
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);
  const graph = buildGraph([entry(EMPTY_CONTRACT_HASH, A, 'm1'), entry(A, B, 'm2')]);
  const at = (storageHash: string): ContractMarkerRecordLike => ({ storageHash, invariants: [] });
  const toEmitted = (emittedHash: string, marker: ContractMarkerRecordLike | null) =>
    migrationPlanForDatabase({ graph, refs: {}, emittedHash }, marker, { kind: 'emitted' });
  const ON_DISK =
    'Migrations on disk already lead from the database to the emitted contract, so a migration planned now would be a second path between the same two contracts, and `db migrate` applies only one of them';
  const NO_MARKER =
    'The database has no marker, so `db migrate` applies every migration on disk from the first, which fits only an empty database. A database that is not empty needs adopting first: record the contract it is at with `{bin} db sign <contract> --db <url>`, naming the migration whose result it matches (`{bin} migration list` shows them), and `db migrate` then applies only the migrations after it';
  const UNAPPLIED =
    'Migrations on disk that the database has not applied come before where a plan for this change would start, and one of them may already make the change, so the plan could not carry it';
  const APPLY_FIRST = `Apply them first with \`{bin} db migrate --to ${B} --db <url>\`, which names the migration.ts to change if one of them fails, then run the command again`;
  const AFTER_PLAN =
    'run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate --db <url>`';

  it('says a database with no marker replays the migrations on disk from the first, and how to adopt one that is not empty', () => {
    expect(
      [at(A), null].map((marker) => printedWayToTarget(PROJECT, toEmitted(B, marker), [])),
    ).toEqual([
      {
        kind: 'on-disk',
        reason: ON_DISK,
        apply: '{bin} db migrate --db <url>',
        text: `${ON_DISK}. Apply them with \`{bin} db migrate --db <url>\`, which names the migration.ts to change if one of them fails`,
      },
      {
        kind: 'on-disk',
        reason: `${ON_DISK}. ${NO_MARKER}`,
        apply: '{bin} db migrate --db <url>',
        text: `${ON_DISK}. ${NO_MARKER}. Apply them with \`{bin} db migrate --db <url>\`, which names the migration.ts to change if one of them fails`,
        adoptFirst: NO_MARKER,
      },
    ]);
  });

  it('prints no plan that carries a statement past migrations the database has not applied, and says to apply them first', () => {
    const applyFirst = {
      command: `{bin} db migrate --to ${B} --db <url>`,
      runs: true,
      text: APPLY_FIRST,
    };
    expect([
      printedWayToTarget(PROJECT, toEmitted(C, at(A)), ['--convert', 'User.age']),
      printedWayToTarget(PROJECT, toEmitted(C, null), ['--convert', 'User.age']),
    ]).toEqual([
      { kind: 'none', reason: `${UNAPPLIED}. ${APPLY_FIRST}`, applyFirst },
      {
        kind: 'none',
        reason: `${UNAPPLIED}. ${NO_MARKER}. ${APPLY_FIRST}`,
        applyFirst: { ...applyFirst, adoptFirst: NO_MARKER },
      },
    ]);
  });

  it('plans a statement from the database when it has applied every migration, and a plan with none past them as before', () => {
    const RUN = 'run `node <migration directory>/migration.ts` for the directory it writes';
    expect([
      printedWayToTarget(PROJECT, toEmitted(C, at(B)), ['--convert', 'User.age']),
      printedWayToTarget(PROJECT, toEmitted(C, at(A)), []),
      printedWayToTarget(PROJECT, toEmitted(C, null), []),
    ]).toEqual([
      {
        kind: 'runs',
        command: `{bin} migration plan --from ${B} --convert User.age`,
        afterPlan: AFTER_PLAN,
      },
      { kind: 'runs', command: `{bin} migration plan --from ${B}`, afterPlan: AFTER_PLAN },
      {
        kind: 'runs',
        command: `{bin} migration plan --from ${B}`,
        afterPlan: `${RUN}. ${NO_MARKER}. Then apply it with \`{bin} db migrate --db <url>\``,
      },
    ]);
  });

  it('starts a plan at @empty, with no note and no step before it, when no migration starts at the empty contract', () => {
    const adopted = buildGraph([entry(A, B, 'm1')]);
    const plan = migrationPlanForDatabase({ graph: adopted, refs: {}, emittedHash: C }, null, {
      kind: 'emitted',
    });
    expect(plan).not.toHaveProperty('startsAfterUnapplied');
    expect([
      printedWayToTarget(PROJECT, plan, ['--convert', 'User.age']),
      printedWayToTarget(PROJECT, plan, []),
    ]).toEqual([
      {
        kind: 'none',
        reason:
          'A plan from `@empty` creates every model, so its statements name nothing it can resolve',
      },
      { kind: 'runs', command: '{bin} migration plan --from @empty', afterPlan: AFTER_PLAN },
    ]);
  });

  it('starts at @empty when the history from the empty contract returns to it', () => {
    const rolledBack = buildGraph([
      entry(EMPTY_CONTRACT_HASH, A, 'm1'),
      entry(A, EMPTY_CONTRACT_HASH, 'm2'),
    ]);
    const plans = [null, at(EMPTY_CONTRACT_HASH)].map((marker) =>
      migrationPlanForDatabase({ graph: rolledBack, refs: {}, emittedHash: C }, marker, {
        kind: 'emitted',
      }),
    );
    expect(plans.map(({ from, startsAfterUnapplied }) => ({ from, startsAfterUnapplied }))).toEqual(
      [
        { from: reference('@empty'), startsAfterUnapplied: undefined },
        { from: reference('@empty'), startsAfterUnapplied: undefined },
      ],
    );
    expect(
      plans.map((plan) => printedWayToTarget(PROJECT, plan, ['--convert', 'User.age'])),
    ).toEqual([
      {
        kind: 'none',
        reason:
          'A plan from `@empty` creates every model, so its statements name nothing it can resolve',
      },
      {
        kind: 'none',
        reason:
          'A plan from `@empty` creates every model, so its statements name nothing it can resolve',
      },
    ]);
  });

  it('names no db migrate to the empty contract when the history from the database ends with a teardown', () => {
    const X = 'd'.repeat(64);
    const tornDown = buildGraph([entry(X, A, 'm1'), entry(A, EMPTY_CONTRACT_HASH, 'm2')]);
    const plan = migrationPlanForDatabase({ graph: tornDown, refs: {}, emittedHash: C }, at(A), {
      kind: 'emitted',
    });
    expect(printedWayToTarget(PROJECT, plan, ['--convert', 'User.age'])).toEqual({
      kind: 'none',
      reason:
        'A plan from `@empty` creates every model, so its statements name nothing it can resolve',
    });
  });
});
