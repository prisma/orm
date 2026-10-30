import type {
  ChangeStrategy,
  DatabasePolicyDifference,
} from '@internal/framework-components/control';
import { ActionableCliError } from './cli-errors';
import { chooseAction, runCommandAction } from './next-actions';
import { type CliInvocation, cliCommand } from './printed-command';

/** A policy setting's value as messages print it: change strategies comma-separated. */
export function databasePolicyValueText(value: DatabasePolicyDifference['declared']): string {
  return typeof value === 'string' ? value : value.join(', ');
}

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
  const why = `${holder} change: ${change.join(', ')}, so ${command} may not move it.`;
  const meta = { spaceId, command, change };
  if (command === 'db migrate') {
    const reconcile = cliCommand(invocation, 'db update', ['--to', args.targetHash]);
    return new ActionableCliError(
      'MIGRATION.CHANGE_POLICY_FORBIDS',
      "This database's change policy permits only db update",
      {
        why,
        fix: `Reconcile the database: ${reconcile}`,
        nextActions: [runCommandAction('Reconcile the database', reconcile)],
        meta,
      },
    );
  }
  const recovery = `Author a migration with ${cliCommand(invocation, 'migration plan')}, then deploy it.`;
  return new ActionableCliError(
    'MIGRATION.CHANGE_POLICY_FORBIDS',
    "This database's change policy permits only migrations",
    { why, fix: recovery, nextActions: [chooseAction(recovery)], meta },
  );
}
