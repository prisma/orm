import type { ContractMarkerRecord } from '@internal/contract/types';
import { errorMarkerPoliciesCorrupt } from '@internal/errors/execution';
import {
  type ChangeStrategy,
  DATA_PROTECTION_KEYS,
  type DatabasePolicies,
  type DatabasePolicyDifference,
  type DeclaredDatabasePolicies,
  databasePoliciesOf,
  databasePolicyDifferences,
  withDeclaredDatabasePolicies,
} from '@internal/framework-components/control';
import type { NamedRef } from '@internal/migration-tools/refs';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { CliStructuredError } from '../../utils/cli-errors';
import {
  type ChangePolicyCheckedCommand,
  type DataProtectionCheckedCommand,
  type DataProtectionRefusedOperation,
  type DataProtectionSetting,
  errorChangePolicyForbids,
  errorDataProtectionForbids,
  errorPolicyMismatch,
  FORBIDDEN_LEVEL,
  type PolicySource,
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
    throw errorMarkerPoliciesCorrupt({
      why: inForce.failure.why,
      space: appSpaceId,
      markerLocation,
    });
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

const STRATEGY_OF: Record<ChangePolicyCheckedCommand, ChangeStrategy> = {
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
  readonly command: ChangePolicyCheckedCommand;
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
        ref:
          ref === undefined
            ? undefined
            : { name: ref.name, permitPolicyChange: args.permitPolicyChange },
        invocation: args.invocation,
      }),
    );
  }
  return ok({ inForce, toWrite });
}

/** The data protection levels a checked run obeys: those it records when it consents to a change, otherwise those in force. */
export function dataProtectionOfRun(
  checked: CheckedDatabasePolicies,
): DatabasePolicies['dataProtection'] {
  return checked.toWrite?.policies.dataProtection ?? checked.inForce.dataProtection;
}

const PERMITTED_LEVEL = {
  dataLoss: 'data-loss-permitted',
  accessWidening: 'access-widening-permitted',
} as const satisfies {
  readonly [S in DataProtectionSetting]: DatabasePolicies['dataProtection'][S];
};

/** The data protection settings a checked run obeys at their `permitted` level: nobody is asked about what they cover. */
export function permittedSettingsOfRun(
  checked: CheckedDatabasePolicies,
): readonly DataProtectionSetting[] {
  const levels = dataProtectionOfRun(checked);
  return DATA_PROTECTION_KEYS.filter((setting) => levels[setting] === PERMITTED_LEVEL[setting]);
}

/** Each data protection setting at its `forbidden` level, with where that level is recorded. */
export type ForbiddingSettings = Partial<Record<DataProtectionSetting, PolicySource>>;

function forbiddingSettings(
  levels: DeclaredDatabasePolicies['dataProtection'],
  sourceOf: (setting: DataProtectionSetting) => PolicySource,
): ForbiddingSettings {
  return Object.fromEntries(
    DATA_PROTECTION_KEYS.flatMap((setting) =>
      levels?.[setting] === FORBIDDEN_LEVEL[setting] ? [[setting, sourceOf(setting)] as const] : [],
    ),
  );
}

/**
 * The settings a checked run forbids. A setting the run records from `ref` is the ref's; any other
 * is the marker's.
 */
export function forbiddingSettingsOfRun(
  checked: CheckedDatabasePolicies,
  ref: NamedRef | undefined,
): ForbiddingSettings {
  const declared = checked.toWrite === undefined ? undefined : ref?.policies?.dataProtection;
  return forbiddingSettings(dataProtectionOfRun(checked), (setting) =>
    ref !== undefined && declared?.[setting] !== undefined
      ? { kind: 'ref', refName: ref.name }
      : { kind: 'marker' },
  );
}

/** The settings `ref` declares at their `forbidden` level, which a plan made for it obeys. */
export function forbiddingSettingsOfRef(ref: NamedRef): ForbiddingSettings {
  return forbiddingSettings(ref.policies?.dataProtection, () => ({
    kind: 'ref',
    refName: ref.name,
  }));
}

/** Refuses the operations that lose data or change access where a forbidden setting covers them; `undefined` when none is refused. */
export function refuseForbiddenChanges(args: {
  readonly appSpaceId: string;
  readonly command: DataProtectionCheckedCommand;
  readonly forbidden: ForbiddingSettings;
  readonly dataLoss: readonly DataProtectionRefusedOperation[];
  readonly accessChanges: readonly DataProtectionRefusedOperation[];
  readonly invocation: CliInvocation | undefined;
}): CliStructuredError | undefined {
  const operationsOf = { dataLoss: args.dataLoss, accessWidening: args.accessChanges };
  const refusals = DATA_PROTECTION_KEYS.flatMap((setting) => {
    const source = args.forbidden[setting];
    const operations = operationsOf[setting];
    return source === undefined || operations.length === 0 ? [] : [{ setting, source, operations }];
  });
  return refusals.length === 0
    ? undefined
    : errorDataProtectionForbids({
        spaceId: args.appSpaceId,
        command: args.command,
        refusals,
        invocation: args.invocation,
      });
}
