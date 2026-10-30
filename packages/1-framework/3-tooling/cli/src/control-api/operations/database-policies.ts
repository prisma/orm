import type { ContractMarkerRecord } from '@internal/contract/types';
import { errorMarkerReadFailed } from '@internal/errors/execution';
import {
  type ChangeStrategy,
  type DatabasePolicies,
  type DeclaredPolicies,
  type PolicyDifference,
  policiesOf,
  policyDifferences,
} from '@internal/framework-components/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import { isStructuredError } from '@internal/utils/structured-error';
import type { CliStructuredError } from '../../utils/cli-errors';
import {
  errorChangePolicyForbids,
  errorPolicyMismatch,
  type PolicyCheckedCommand,
} from '../../utils/policy-errors';
import type { CliInvocation } from '../../utils/printed-command';
import type { TargetRef } from '../types';

/**
 * The policies in force on each space: what its marker records, filled from the defaults. A marker
 * whose recorded policies are invalid is an unreadable marker of that space.
 */
export function policiesInForce(
  markers: ReadonlyMap<string, ContractMarkerRecord | null>,
  spaceIds: readonly string[],
  markerLocation: string,
): ReadonlyMap<string, DatabasePolicies> {
  return new Map(
    spaceIds.map((space) => {
      try {
        return [space, policiesOf(markers.get(space) ?? undefined)] as const;
      } catch (error) {
        if (isStructuredError(error) && error.code === 'CONTRACT.MARKER_READ_FAILED') {
          throw errorMarkerReadFailed({
            why: error.why ?? error.message,
            space,
            markerLocation,
            cause: error,
          });
        }
        throw error;
      }
    }),
  );
}

/** The policies a run writes: the ref's declarations laid over those in force, and what changed. */
export interface PoliciesToWrite {
  readonly policies: DatabasePolicies;
  readonly differences: readonly PolicyDifference[];
}

function withDeclared(inForce: DatabasePolicies, declared: DeclaredPolicies): DatabasePolicies {
  return {
    change: [...new Set(declared.change ?? inForce.change)].sort(),
    dataProtection: {
      dataLoss: declared.dataProtection?.dataLoss ?? inForce.dataProtection.dataLoss,
      accessWidening:
        declared.dataProtection?.accessWidening ?? inForce.dataProtection.accessWidening,
    },
  };
}

const STRATEGY_OF: Record<PolicyCheckedCommand, ChangeStrategy> = {
  'db migrate': 'migrate',
  'db update': 'reconcile',
  'db sign': 'reconcile',
};

/**
 * Checks a run against the policies in force, before it plans anything. A ref whose declared
 * policies differ refuses the run unless `permitPolicyChange` consents to writing them, which only
 * the application space's ref can declare. Then every space's change policy, with the ref's
 * declarations in force for the application space, must permit the command.
 */
export function checkRunPolicies(args: {
  readonly command: PolicyCheckedCommand;
  readonly appSpaceId: string;
  readonly inForce: ReadonlyMap<string, DatabasePolicies>;
  readonly ref: TargetRef | undefined;
  readonly permitPolicyChange: boolean;
  readonly targetHash: string;
  readonly invocation: CliInvocation | undefined;
}): Result<PoliciesToWrite | undefined, CliStructuredError> {
  const { appSpaceId, inForce, ref } = args;
  const appInForce = inForce.get(appSpaceId) ?? policiesOf(undefined);
  const differences =
    ref?.policies === undefined ? [] : policyDifferences(ref.policies, appInForce);
  let toWrite: PoliciesToWrite | undefined;
  if (ref?.policies !== undefined && differences.length > 0) {
    if (!args.permitPolicyChange) {
      return notOk(
        errorPolicyMismatch({ spaceId: appSpaceId, refName: ref.name ?? ref.hash, differences }),
      );
    }
    toWrite = { policies: withDeclared(appInForce, ref.policies), differences };
  }
  const required = STRATEGY_OF[args.command];
  for (const [spaceId, policies] of inForce) {
    const { change } = spaceId === appSpaceId && toWrite ? toWrite.policies : policies;
    if (!change.includes(required)) {
      return notOk(
        errorChangePolicyForbids({
          spaceId,
          command: args.command,
          change,
          targetHash: args.targetHash,
          invocation: args.invocation,
        }),
      );
    }
  }
  return ok(toWrite);
}

/** `change: migrate; dataLoss: data-loss-forbidden`: the settings a run wrote, as output names them. */
export function writtenSettingsText(differences: readonly PolicyDifference[]): string {
  return differences
    .map(
      ({ setting, declared }) =>
        `${setting}: ${typeof declared === 'string' ? declared : declared.join(', ')}`,
    )
    .join('; ');
}
