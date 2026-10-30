import type { ContractMarkerRecord } from '@internal/contract/types';
import { errorMarkerRowCorrupt } from '@internal/errors/execution';
import {
  type ChangeStrategy,
  type DatabasePolicies,
  type DatabasePolicyDifference,
  databasePoliciesOf,
  databasePolicyDifferences,
  withDeclaredDatabasePolicies,
} from '@internal/framework-components/control';
import type { NamedRef } from '@internal/migration-tools/refs';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { CliStructuredError } from '../../utils/cli-errors';
import {
  errorChangePolicyForbids,
  errorPolicyMismatch,
  type PolicyCheckedCommand,
} from '../../utils/policy-errors';
import type { CliInvocation } from '../../utils/printed-command';

/**
 * The database's policies in force: what the application space's marker records, filled from
 * the defaults. A marker whose recorded policies are not valid is a corrupt marker row.
 */
export function databasePoliciesInForce(
  markers: ReadonlyMap<string, ContractMarkerRecord | null>,
  appSpaceId: string,
  markerLocation: string,
): DatabasePolicies {
  const inForce = databasePoliciesOf(markers.get(appSpaceId));
  if (!inForce.ok) {
    throw errorMarkerRowCorrupt({ why: inForce.failure.why, space: appSpaceId, markerLocation });
  }
  return inForce.value;
}

/** The policies a run records: the ref's declarations laid over those in force, and what changed. */
export interface DatabasePoliciesToWrite {
  readonly policies: DatabasePolicies;
  readonly differences: readonly DatabasePolicyDifference[];
}

/** The policies a run was checked against, and those it records when it consents to a change. */
export interface CheckedDatabasePolicies {
  readonly inForce: DatabasePolicies;
  readonly toWrite: DatabasePoliciesToWrite | undefined;
}

const STRATEGY_OF: Record<PolicyCheckedCommand, ChangeStrategy> = {
  'db migrate': 'migrate',
  'db update': 'reconcile',
  'db sign': 'reconcile',
};

/**
 * Checks a run against the database's policies, once, before it plans anything. A ref whose
 * declared policies differ refuses the run unless `permitPolicyChange` consents to recording
 * them. Then the change policy the run would leave in force must permit the command.
 */
export function checkRunPolicies(args: {
  readonly command: PolicyCheckedCommand;
  readonly appSpaceId: string;
  readonly inForce: DatabasePolicies;
  readonly ref: NamedRef | undefined;
  readonly permitPolicyChange: boolean;
  readonly targetHash: string;
  readonly invocation: CliInvocation | undefined;
}): Result<CheckedDatabasePolicies, CliStructuredError> {
  const { appSpaceId, inForce, ref } = args;
  const declared = ref?.policies;
  const differences = declared === undefined ? [] : databasePolicyDifferences(declared, inForce);
  if (ref !== undefined && differences.length > 0 && !args.permitPolicyChange) {
    return notOk(errorPolicyMismatch({ spaceId: appSpaceId, refName: ref.name, differences }));
  }
  const toWrite =
    declared !== undefined && differences.length > 0
      ? { policies: withDeclaredDatabasePolicies(inForce, declared), differences }
      : undefined;
  const required = STRATEGY_OF[args.command];
  const declaresChange = toWrite !== undefined && declared?.change !== undefined;
  const change = toWrite?.policies.change ?? inForce.change;
  if (!change.includes(required)) {
    return notOk(
      errorChangePolicyForbids({
        spaceId: appSpaceId,
        command: args.command,
        change,
        source:
          declaresChange && ref !== undefined
            ? { kind: 'ref', refName: ref.name }
            : { kind: 'marker' },
        targetHash: args.targetHash,
        invocation: args.invocation,
      }),
    );
  }
  return ok({ inForce, toWrite });
}
