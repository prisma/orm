import { ifDefined } from '@internal/utils/defined';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { relative } from 'pathe';
import {
  type MigrationPlanArgument,
  type MigrationPlanArguments,
  type MigrationPlanTargetArgument,
  migrationPlanFromForStatements,
  noMarkerReplayText,
  type RunnablePlanArgument,
} from '../control-api/operations/plan-arguments';
import { shellQuoted } from '../control-api/statements/statement-flag';
import { chooseAction, runCommandAction } from './next-actions';

/**
 * Where the user ran the CLI from, the `--config` they gave it, as they typed it, and whether they
 * gave it `--db`.
 */
export interface CliInvocation {
  readonly cwd: string;
  readonly configPath: string | undefined;
  readonly dbGiven: boolean;
  /** The flags other than statements that a re-run of the same command repeats: those the user gave. */
  readonly rerunArgs?: readonly string[];
  /** The run's statements, as flags, which another command that plans the same change repeats. */
  readonly statementArgs?: readonly string[];
}

/** The invocation of a command run with `ctx`, given `--db` when `db` is defined. */
export function cliInvocation(
  ctx: { readonly cwd: string; readonly configPath: string | undefined },
  db: string | undefined,
): CliInvocation {
  return { cwd: ctx.cwd, configPath: ctx.configPath, dbGiven: db !== undefined };
}

/** The flags of `db migrate` or `db update` that a re-run repeats, as the user gave them. */
export function rerunFlags(flags: {
  readonly to: string | undefined;
  readonly advanceRef: string | undefined;
  readonly permitPolicyChange: boolean | undefined;
}): readonly string[] {
  return [
    ...(flags.to === undefined ? [] : ['--to', shellQuoted(flags.to)]),
    ...(flags.advanceRef === undefined ? [] : ['--advance-ref', shellQuoted(flags.advanceRef)]),
    ...(flags.permitPolicyChange === true ? ['--permit-policy-change'] : []),
  ];
}

/** The `db migrate` the user ran, with the flags they gave. */
export function dbMigrateRerun(invocation: CliInvocation): string {
  return cliCommand(invocation, 'db migrate', invocation.rerunArgs ?? []);
}

/**
 * The `db migrate` that applies what a failed `db update` advises to plan to `to`. It repeats the
 * flags the user gave `db update`, which `db migrate` takes with the same meaning: `--to`, and
 * `--advance-ref` and `--permit-policy-change`, without which it would not do what `db update` was
 * asked to. Without a `--to` among them, it takes the plan's.
 */
export function dbUpdateApplyCommand(
  invocation: CliInvocation | undefined,
  to: MigrationPlanTargetArgument,
): string {
  const given = invocation?.rerunArgs ?? [];
  const target = given.includes('--to') || to.kind === 'none' ? [] : argumentWords('--to', to);
  return cliCommand(invocation, 'db migrate', [...target, ...given]);
}

/** The `db update` the user ran, with the flags they gave and `statements`, by default the run's own. */
export function dbUpdateRerun(
  invocation: CliInvocation,
  statements: readonly string[] = invocation.statementArgs ?? [],
): string {
  return cliCommand(invocation, 'db update', [...(invocation.rerunArgs ?? []), ...statements]);
}

/** The commands that connect to a database: those whose flags include `dbFlag`, which a test checks. */
const COMMANDS_TAKING_DB: ReadonlySet<string> = new Set([
  'contract infer',
  'db init',
  'db migrate',
  'db schema',
  'db sign',
  'db update',
  'db verify',
  'migration log',
  'migration status',
]);

function configWords(configPath: string | undefined): readonly string[] {
  return configPath === undefined ? [] : ['--config', shellQuoted(configPath)];
}

/**
 * A CLI command as advice prints it: `{bin}`, the command and its arguments, the `--config` the CLI
 * was given, and, for a command that connects to a database, `--db <url>` when the CLI was given
 * `--db`, so it runs as printed from the directory the CLI ran in, against the same database. The
 * URL stays a placeholder because it can hold credentials.
 */
export function cliCommand(
  invocation: CliInvocation | undefined,
  command: string,
  args: readonly string[] = [],
): string {
  return [
    '{bin}',
    command,
    ...args,
    ...configWords(invocation?.configPath),
    ...(invocation?.dbGiven === true && COMMANDS_TAKING_DB.has(command) ? ['--db', '<url>'] : []),
  ].join(' ');
}

/** A `migration plan` that starts at `from`, as advice prints it; `from` resolves as printed. */
export function printedPlanCommand(
  invocation: CliInvocation | undefined,
  from: RunnablePlanArgument,
  flags: readonly string[],
): string {
  return cliCommand(invocation, 'migration plan', [...argumentWords('--from', from), ...flags]);
}

/** What advice prints where `--from` is for the user to choose. */
export const CONTRACT_PLACEHOLDER = '<contract>';

/**
 * A `migration plan` as advice prints it:
 * - `runs`: the command runs as printed;
 * - `fill`: a choice: its `--from` is {@link CONTRACT_PLACEHOLDER}, or the one candidate, and `fill`
 *   says why and what it takes;
 * - `none`: no `migration plan` can do it, and `reason` says why.
 */
export type PrintedPlan =
  | { readonly kind: 'runs'; readonly command: string }
  | { readonly kind: 'fill'; readonly command: string; readonly fill: string }
  | { readonly kind: 'none'; readonly reason: string };

/** The `migration plan` that goes from `plan.from` to `plan.to` (the emitted contract when absent) with `flags`. */
export function printedPlan(
  invocation: CliInvocation | undefined,
  plan: { readonly from: MigrationPlanArgument; readonly to?: MigrationPlanTargetArgument },
  flags: readonly string[],
): PrintedPlan {
  const { to = { kind: 'default' } as const } = plan;
  const from = carriesStatement(flags) ? migrationPlanFromForStatements(plan.from) : plan.from;
  if (from.kind === 'none' || to.kind === 'none') {
    const reasons = [from, to].flatMap((argument) =>
      argument.kind === 'none' ? [argument.reason] : [],
    );
    return { kind: 'none', reason: reasons.join('. ') };
  }
  const words = [...argumentWords('--to', to), ...flags];
  return from.kind === 'ambiguous'
    ? printedChoicePlan(invocation, from, words)
    : { kind: 'runs', command: printedPlanCommand(invocation, from, words) };
}

/**
 * What advice prints to move the database where a run was going, by how it gets there through
 * migrations:
 * - a {@link PrintedPlan} that runs or is a choice: plan a migration with it, then `afterPlan`,
 *   which adds any invariant the target requires, runs the migration.ts it writes and applies it
 *   with `apply`;
 * - `at-target`: the database is already there, as `reason` says, and there is nothing to move;
 * - `on-disk`: migrations on disk lead there; `reason` says why no plan is printed, `text` says to
 *   apply them with `apply`, and `adoptFirst`, for a database with no marker, how to adopt one that
 *   is not empty before that;
 * - `none`: no `migration plan` moves it, for `reason`, which says what does where something can.
 */
export type PrintedWayToTarget =
  | (Exclude<PrintedPlan, { readonly kind: 'none' }> & { readonly afterPlan: string })
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'at-target'; readonly reason: string }
  | {
      readonly kind: 'on-disk';
      readonly reason: string;
      readonly apply: string;
      readonly text: string;
      readonly adoptFirst?: string;
    };

/**
 * How advice moves the database `plan` describes to `plan.to`: with the `migration plan` from
 * `plan.from` with `flags`, by applying migrations on disk, or why neither can. `apply` is the
 * `db migrate` that applies the result, by default the one that follows `db update`.
 */
export function printedWayToTarget(
  invocation: CliInvocation | undefined,
  plan: MigrationPlanArguments,
  flags: readonly string[],
  apply: string = dbUpdateApplyCommand(invocation, plan.to),
): PrintedWayToTarget {
  const target = targetText(plan.to);
  const migrations = plan.migrationsToTarget ?? { kind: 'plan-needed', missingInvariants: [] };
  switch (migrations.kind) {
    case 'none-needed':
      return {
        kind: 'at-target',
        reason: `The database is already at ${target} and records every invariant it requires, so there is no migration to apply`,
      };
    case 'on-disk': {
      const onDisk = `Migrations on disk already lead from the database to ${target}, so a migration planned now would be a second path between the same two contracts, and \`db migrate\` applies only one of them`;
      const adoptFirst = noMarkerText(invocation, plan);
      const reason = adoptFirst === undefined ? onDisk : `${onDisk}. ${adoptFirst}`;
      return {
        kind: 'on-disk',
        reason,
        apply,
        text: `${reason}. Apply them with \`${apply}\`, which names the migration.ts to change if one of them fails`,
        ...ifDefined('adoptFirst', adoptFirst),
      };
    }
    case 'at-target-missing-invariants': {
      const { missingInvariants, newMigration } = migrations;
      const finish = (migrationTs: string) =>
        `add to ${migrationTs} ${transformsText(missingInvariants)}, run \`${writtenMigrationRunCommand(invocation)}\` for its directory, and apply it with \`${apply}\``;
      return {
        kind: 'none',
        reason: `The database is at ${target}, but no migration on disk provides ${invariantsText(missingInvariants)} it requires and the database does not record, and a plan from a contract to itself is empty. ${selfMigrationText(invocation, target, newMigration, finish)}`,
      };
    }
    case 'plan-needed': {
      const adoptFirst = noMarkerText(invocation, plan);
      if (
        plan.startsAfterUnapplied === true &&
        carriesStatement(flags) &&
        plan.from.kind !== 'none'
      ) {
        return { kind: 'none', reason: applyUnappliedFirst(invocation, plan.from, adoptFirst) };
      }
      const printed = printedPlan(invocation, plan, flags);
      if (printed.kind === 'none') return printed;
      const { missingInvariants } = migrations;
      const provide =
        missingInvariants.length === 0 ? '' : `add to it ${transformsText(missingInvariants)}, `;
      const applied = `${provide}run \`${writtenMigrationRunCommand(invocation)}\` for the directory it writes, and apply it with \`${apply}\``;
      return {
        ...printed,
        afterPlan: adoptFirst === undefined ? applied : `${applied}. ${adoptFirst}`,
      };
    }
  }
}

/**
 * For a database with no marker in a space with migrations, why `db migrate` fits it only when it
 * is empty, and how to adopt it when it is not.
 */
function noMarkerText(
  invocation: CliInvocation | undefined,
  plan: MigrationPlanArguments,
): string | undefined {
  if (plan.position?.kind !== 'unmarked' || plan.startsAfterUnapplied !== true) return undefined;
  return noMarkerReplayText(
    cliCommand(invocation, 'db sign', [CONTRACT_PLACEHOLDER]),
    cliCommand(invocation, 'migration list'),
  );
}

/**
 * Why advice that carries a statement prints no plan from `from`, past migrations on disk the
 * database has not applied: one of them may already make the change. It says to apply them first,
 * after `adoptFirst` for a database with no marker, then run the command again.
 */
function applyUnappliedFirst(
  invocation: CliInvocation | undefined,
  from: Exclude<MigrationPlanArgument, { readonly kind: 'none' }>,
  adoptFirst: string | undefined,
): string {
  const end = from.kind === 'reference' ? from.reference : CONTRACT_PLACEHOLDER;
  const migrate = `\`${cliCommand(invocation, 'db migrate', ['--to', shellQuoted(end)])}\``;
  const choose =
    from.kind === 'ambiguous' && from.candidates.length > 0
      ? `, replacing ${CONTRACT_PLACEHOLDER} with one of ${from.candidates.map((each) => `\`${each}\``).join(', ')}`
      : '';
  const apply = `Apply them first with ${migrate}${choose}, which names the migration.ts to change if one of them fails, then run the command again`;
  const lead =
    'Migrations on disk that the database has not applied come before where a plan for this change would start, and one of them may already make the change, so the plan could not carry it';
  return adoptFirst === undefined ? `${lead}. ${apply}` : `${lead}. ${adoptFirst}. ${apply}`;
}

/**
 * How to write a migration from `target`, the contract the database is at, to itself, then
 * `finish` it, given the words that name its migration.ts.
 */
function selfMigrationText(
  invocation: CliInvocation | undefined,
  target: string,
  newMigration: { readonly from: string; readonly emitFirst: boolean } | undefined,
  finish: (migrationTs: string) => string,
): string {
  if (newMigration === undefined) {
    return `Write a migration from that contract to itself, ${finish('its migration.ts')}`;
  }
  const command = `\`${cliCommand(invocation, 'migration new', ['--from', newMigration.from])}\``;
  if (!newMigration.emitFirst) {
    return `Write a migration from that contract to itself with ${command}, ${finish('its migration.ts')}`;
  }
  const emit = `\`${cliCommand(invocation, 'contract emit')}\``;
  return `Change your contract source so it describes ${target} and run ${emit}, then write a migration from that contract to itself with ${command}. Then change your contract source back and run ${emit} again, because \`db update\` and \`migration plan\` target the emitted contract. Then ${finish("the new migration's migration.ts")}`;
}

function targetText(to: MigrationPlanTargetArgument): string {
  switch (to.kind) {
    case 'reference':
      return `\`${to.reference}\``;
    case 'default':
      return 'the emitted contract';
    case 'none':
      return 'the contract the run moves it to';
  }
}

function quotedInvariants(invariants: readonly string[]): string {
  return invariants.map((id) => JSON.stringify(id)).join(', ');
}

function invariantsText(invariants: readonly string[]): string {
  return `${invariants.length === 1 ? 'the invariant' : 'the invariants'} ${quotedInvariants(invariants)}`;
}

/** The `dataTransform` operations that provide `invariants`: each carries one `invariantId`. */
function transformsText(invariants: readonly string[]): string {
  return invariants.length === 1
    ? `a \`dataTransform\` with \`invariantId\` ${quotedInvariants(invariants)}`
    : `a \`dataTransform\` for each of the invariants ${quotedInvariants(invariants)}, with that invariant as its \`invariantId\``;
}

const STATEMENT_FLAGS: ReadonlySet<string> = new Set([
  '--rename',
  '--delete',
  '--convert',
  '--backfill',
]);

function carriesStatement(flags: readonly string[]): boolean {
  return flags.some((flag) => STATEMENT_FLAGS.has(flag.split(/[\s=]/)[0] ?? ''));
}

/**
 * A `migration plan` whose `--from` the user chooses, for `choice.reason`, from `choice.candidates`:
 * with one candidate, the command names it and the reason says when it fits.
 */
export function printedChoicePlan(
  invocation: CliInvocation | undefined,
  choice: Extract<MigrationPlanArgument, { readonly kind: 'ambiguous' }>,
  flags: readonly string[],
): Extract<PrintedPlan, { readonly kind: 'fill' }> {
  const [only] = choice.candidates;
  if (choice.candidates.length === 1 && only !== undefined) {
    return {
      kind: 'fill',
      command: printedPlanCommand(invocation, { kind: 'reference', reference: only }, flags),
      fill: choice.reason,
    };
  }
  const statements = carriesStatement(flags);
  const choices =
    choice.candidates.length > 0
      ? `one of ${choice.candidates.map((candidate) => `\`${candidate}\``).join(', ')}`
      : `a contract \`${cliCommand(invocation, 'migration list')}\` shows${statements ? ' or a ref that names one' : ', a ref that names one, or `@empty`'}`;
  return {
    kind: 'fill',
    command: cliCommand(invocation, 'migration plan', ['--from', CONTRACT_PLACEHOLDER, ...flags]),
    fill: `${choice.reason}, so replace ${CONTRACT_PLACEHOLDER} with ${choices}`,
  };
}

/** `plan` quoted for a sentence: its command, followed for `fill` by what to put in its placeholder. */
export function quotedPlan(plan: Exclude<PrintedPlan, { readonly kind: 'none' }>): string {
  return plan.kind === 'runs' ? `\`${plan.command}\`` : `\`${plan.command}\` (${plan.fill})`;
}

/** The next action for `plan`: a command when it runs, otherwise the choice or the reason it has none. */
export function planAction(label: string, plan: PrintedPlan): NextAction {
  switch (plan.kind) {
    case 'runs':
      return runCommandAction(label, plan.command);
    case 'fill':
      return chooseAction(`${label} with \`${plan.command}\`. ${plan.fill}.`);
    case 'none':
      return chooseAction(plan.reason);
  }
}

function argumentWords(flag: string, argument: RunnablePlanArgument): readonly string[] {
  return argument.kind === 'reference' ? [flag, shellQuoted(argument.reference)] : [];
}

/**
 * The command that runs a `migration.ts`, named relative to the directory the CLI ran in, with the
 * `--config` the CLI was given, so it loads the same config.
 */
export function selfEmitCommand(invocation: CliInvocation, migrationTs: string): string {
  return [
    'node',
    shellQuoted(printedPath(invocation, migrationTs)),
    ...configWords(invocation.configPath),
  ].join(' ');
}

/** The command that runs the `migration.ts` a `migration plan` writes, with its directory a placeholder. */
export function writtenMigrationRunCommand(invocation: CliInvocation | undefined): string {
  return [
    'node',
    '<migration directory>/migration.ts',
    ...configWords(invocation?.configPath),
  ].join(' ');
}

/** A path as advice prints it: relative to the directory the CLI ran in. */
export function printedPath(invocation: CliInvocation, path: string): string {
  return relative(invocation.cwd, path);
}
