import {
  type ChangeStrategy,
  type DatabasePolicies,
  type DatabasePolicyDifference,
  databasePolicyValueText,
  movedDatabasePoliciesWhy,
} from '@internal/framework-components/control';
import { shellQuoted } from '../control-api/statements/statement-flag';
import { ActionableCliError } from './cli-errors';
import { chooseAction, runCommandAction } from './next-actions';
import { type CliInvocation, cliCommand } from './printed-command';

/** `change: migrate; dataProtection.dataLoss: data-loss-forbidden`: the declared side of each difference. */
export function declaredSettingsText(differences: readonly DatabasePolicyDifference[]): string {
  return differences
    .map(({ setting, declared }) => `${setting}: ${databasePolicyValueText(declared)}`)
    .join('; ');
}

/** `MIGRATION.POLICY_MISMATCH`: the ref declares policies that differ from those the database's marker records. */
export function errorPolicyMismatch(args: {
  readonly spaceId: string;
  readonly refName: string;
  readonly differences: readonly DatabasePolicyDifference[];
}): ActionableCliError {
  const { spaceId, refName, differences } = args;
  const why = differences
    .map(
      ({ setting, declared, inForce }) =>
        `${refName} declares ${setting}: ${databasePolicyValueText(declared)}; the database has ${setting}: ${databasePolicyValueText(inForce)}.`,
    )
    .join(' ');
  const recovery =
    "Make the ref match the database, or have whoever owns the database apply the ref's policies.";
  return new ActionableCliError(
    'MIGRATION.POLICY_MISMATCH',
    "The ref's policies differ from the database's",
    {
      why,
      fix: recovery,
      nextActions: [chooseAction(recovery)],
      meta: { spaceId, refName, differences },
    },
  );
}

export type PolicyCheckedCommand = 'db update' | 'db sign' | 'db migrate';

/** Where the refused change policy comes from: the database's marker, or the ref a run consents to record. */
export type ChangePolicySource =
  | { readonly kind: 'marker' }
  | { readonly kind: 'ref'; readonly refName: string };

/** `MIGRATION.CHANGE_POLICY_FORBIDS`: the change policy does not permit the command's way of changing the database. */
export function errorChangePolicyForbids(args: {
  readonly spaceId: string;
  readonly command: PolicyCheckedCommand;
  readonly change: readonly ChangeStrategy[];
  readonly source: ChangePolicySource;
  /** The contract the refused command was moving the database to. */
  readonly targetHash: string;
  readonly invocation: CliInvocation | undefined;
}): ActionableCliError {
  const { spaceId, command, change, invocation, source } = args;
  const holder = source.kind === 'ref' ? `${source.refName} declares` : 'The marker records';
  const policyHolder =
    source.kind === 'ref'
      ? `${source.refName} declares a change policy that`
      : "This database's change policy";
  const refusal = command === 'db sign' ? 'may not sign it' : 'may not move it';
  const why = `${holder} change: ${change.join(', ')}, so ${command} ${refusal}.`;
  const meta = { spaceId, command, change };
  const toTarget =
    source.kind === 'ref'
      ? ['--to', shellQuoted(source.refName), '--permit-policy-change']
      : ['--to', args.targetHash];
  if (command === 'db migrate') {
    const reconcile = cliCommand(invocation, 'db update', toTarget);
    return new ActionableCliError(
      'MIGRATION.CHANGE_POLICY_FORBIDS',
      `${policyHolder} permits only db update`,
      {
        why,
        fix: `Reconcile the database: ${reconcile}`,
        nextActions: [runCommandAction('Reconcile the database', reconcile)],
        meta,
      },
    );
  }
  const migrate = cliCommand(invocation, 'db migrate', source.kind === 'ref' ? toTarget : []);
  const recovery = `Author a migration with ${cliCommand(invocation, 'migration plan')}, then apply it with ${migrate}.`;
  return new ActionableCliError(
    'MIGRATION.CHANGE_POLICY_FORBIDS',
    `${policyHolder} permits only migrations`,
    { why, fix: recovery, nextActions: [chooseAction(recovery)], meta },
  );
}

/** `CLI.INVALID_ARGUMENTS`: `--permit-policy-change` was given, but `to` names no ref whose policies it could write. */
export function errorPermitPolicyChangeNeedsRef(args: {
  readonly command: 'db migrate' | 'db update';
  readonly to: string | undefined;
}): ActionableCliError {
  const { command, to } = args;
  const recovery =
    'Name the ref whose policies to write with --to <ref>, or leave out --permit-policy-change.';
  return new ActionableCliError(
    'CLI.INVALID_ARGUMENTS',
    '--permit-policy-change needs --to <ref>',
    {
      why:
        to === undefined
          ? 'No ref was given, so there are no policies to write.'
          : `${to} is not a ref, so it declares no policies to write.`,
      fix: recovery,
      nextActions: [chooseAction(recovery)],
      meta: { command, ...(to === undefined ? {} : { to }) },
    },
  );
}

/** `MIGRATION.MARKER_CAS_FAILURE` for `db sign`: the database's policies changed after it checked them, so it did not sign the application space. */
export function errorDatabasePoliciesMovedDuringSign(args: {
  readonly spaceId: string;
  readonly checked: DatabasePolicies;
  readonly found: DatabasePolicies;
  readonly invocation: CliInvocation;
}): ActionableCliError {
  const rerun = cliCommand(args.invocation, 'db sign', args.invocation.rerunArgs ?? []);
  return new ActionableCliError(
    'MIGRATION.MARKER_CAS_FAILURE',
    "The database's policies changed while db sign ran",
    {
      why: `${movedDatabasePoliciesWhy('db sign', args.checked, args.found)} db sign did not sign the application space.`,
      fix: `Sign again, which checks the policies anew: ${rerun}`,
      nextActions: [runCommandAction('Sign again', rerun)],
      meta: {
        reason: 'databasePolicies',
        space: args.spaceId,
        checkedDatabasePolicies: args.checked,
        foundDatabasePolicies: args.found,
      },
    },
  );
}
