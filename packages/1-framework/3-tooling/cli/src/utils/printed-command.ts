import type { NextAction } from '@prisma/cli-engine/protocol';
import { relative } from 'pathe';
import {
  type MigrationPlanArgument,
  type MigrationPlanTargetArgument,
  migrationPlanFromForStatements,
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

/** The `db migrate` that applies a migration a `migration plan` to `to` writes. */
export function dbMigrateToCommand(
  invocation: CliInvocation | undefined,
  to: MigrationPlanTargetArgument = { kind: 'default' },
): string {
  return cliCommand(invocation, 'db migrate', to.kind === 'none' ? [] : argumentWords('--to', to));
}

/**
 * The `db migrate` that applies what a failed `db update` advises to plan to `to`. It repeats the
 * flags the user gave `db update`, which `db migrate` takes with the same meaning: `--to`, which
 * names the contract the plan ends at, and `--advance-ref` and `--permit-policy-change`, without
 * which it would not do what `db update` was asked to. A caller that gives no flags gets `--to`.
 */
export function dbUpdateApplyCommand(
  invocation: CliInvocation | undefined,
  to: MigrationPlanTargetArgument,
): string {
  return invocation?.rerunArgs === undefined
    ? dbMigrateToCommand(invocation, to)
    : cliCommand(invocation, 'db migrate', invocation.rerunArgs);
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
export function writtenMigrationRunCommand(invocation: CliInvocation): string {
  return ['node', '<migration directory>/migration.ts', ...configWords(invocation.configPath)].join(
    ' ',
  );
}

/** A path as advice prints it: relative to the directory the CLI ran in. */
export function printedPath(invocation: CliInvocation, path: string): string {
  return relative(invocation.cwd, path);
}
