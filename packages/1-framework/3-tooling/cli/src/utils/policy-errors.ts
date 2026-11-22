import {
  type ChangeStrategy,
  type DatabasePolicies,
  type DatabasePolicyDifference,
  databasePolicyValueText,
  type MigrationDataLossKind,
  movedDatabasePoliciesWhy,
} from '@internal/framework-components/control';
import type { MigrationPlanArgument } from '../control-api/operations/plan-arguments';
import { shellQuoted } from '../control-api/statements/statement-flag';
import { ActionableCliError } from './cli-errors';
import { type DataProtectionSetting, FORBIDDEN_LEVEL } from './data-protection-settings';
import { chooseAction, runCommandAction } from './next-actions';
import { type CliInvocation, cliCommand, printedPlan, quotedPlan } from './printed-command';

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

export type ChangePolicyCheckedCommand = 'db update' | 'db sign' | 'db migrate';

/** Where a refused policy comes from: the database's marker, or the ref a run consents to record or a plan is made for. */
export type PolicySource =
  | { readonly kind: 'marker' }
  | { readonly kind: 'ref'; readonly refName: string };

/** `MIGRATION.CHANGE_POLICY_FORBIDS`: the change policy does not permit the command's way of changing the database. */
export function errorChangePolicyForbids(args: {
  readonly spaceId: string;
  readonly command: ChangePolicyCheckedCommand;
  readonly change: readonly ChangeStrategy[];
  readonly source: PolicySource;
  /** The contract the refused command was moving the database to. */
  readonly targetHash: string;
  /** The ref the user named, and whether they gave `--permit-policy-change`, which the advised command repeats. */
  readonly ref?: { readonly name: string; readonly permitPolicyChange: boolean } | undefined;
  /** The `--from` a `migration plan` for the database takes, which the advice to author a migration prints. */
  readonly migrationPlanOrigin: MigrationPlanArgument;
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
  const ref = source.kind === 'ref' ? { name: source.refName, permitPolicyChange: true } : args.ref;
  const toRef =
    ref === undefined
      ? []
      : [
          '--to',
          shellQuoted(ref.name),
          ...(ref.permitPolicyChange ? ['--permit-policy-change'] : []),
        ];
  if (command === 'db migrate') {
    const reconcile = cliCommand(
      invocation,
      'db update',
      ref === undefined ? ['--to', args.targetHash] : toRef,
    );
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
  const migrate = cliCommand(invocation, 'db migrate', toRef);
  const plan = printedPlan(invocation, { from: args.migrationPlanOrigin }, []);
  const recovery =
    plan.kind === 'none'
      ? `No migration can be planned to move it. ${plan.reason}.`
      : `Author a migration with ${quotedPlan(plan)}, then apply it with \`${migrate}\`.`;
  return new ActionableCliError(
    'MIGRATION.CHANGE_POLICY_FORBIDS',
    `${policyHolder} permits only migrations`,
    { why, fix: recovery, nextActions: [chooseAction(recovery)], meta },
  );
}

export type DataProtectionCheckedCommand = 'db migrate' | 'db update' | 'migration plan';

/** An operation a data protection setting refuses: its subject as the user names it, and for `db migrate` the migration that holds it. */
export interface DataProtectionRefusedOperation {
  readonly spaceId: string;
  readonly migration?: string;
  readonly operationId?: string;
  readonly subject: string;
  readonly label: string;
  /** How the operation loses data, when the plan says. */
  readonly loss?: MigrationDataLossKind;
}

/** A data protection setting at its `forbidden` level, where it is recorded, and the operations it refuses. */
export interface DataProtectionRefusal {
  readonly setting: DataProtectionSetting;
  readonly source: PolicySource;
  readonly operations: readonly DataProtectionRefusedOperation[];
}

const FORBIDDEN_CHANGE = {
  dataLoss: 'data loss',
  accessWidening: 'changing who can read or write data',
} as const satisfies { readonly [S in DataProtectionSetting]: string };

/** Who refuses the change: the database's own policy, or the one a ref declares for its database. */
function refusingPolicy(source: PolicySource, forbids: string): string {
  return source.kind === 'ref'
    ? `${source.refName} declares a data protection policy that forbids ${forbids}, so these operations cannot run on the database it describes.`
    : `This database's data protection policy forbids ${forbids}, so these operations cannot run on it.`;
}

const KEEP_APPLIED_MIGRATION =
  'If another database has already applied a migration listed here, keep it as it is.';

function doItAnyway(source: PolicySource): string {
  return source.kind === 'ref'
    ? `To do it anyway, whoever owns that database must first change the data protection policy ${source.refName} declares.`
    : 'To do it anyway, whoever owns the database must first change its data protection policy.';
}

function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return quoted.length === 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** The extensions' contract spaces own their migrations: only the extensions' authors can change them. */
function extensionsOwnMigrations(spaceIds: readonly string[]): string {
  return spaceIds.length === 1
    ? `Contract space ${quotedList(spaceIds)} belongs to an extension, so do not edit or delete its migrations; ask the extension's author for a version without the operation.`
    : `Contract spaces ${quotedList(spaceIds)} belong to extensions, so do not edit or delete their migrations; ask the extensions' authors for versions without the operations.`;
}

/** What a user can do about refused operations in the application's contract space, for the command that refused them. */
function keepAppProtected(
  setting: DataProtectionSetting,
  command: DataProtectionCheckedCommand,
  operations: readonly DataProtectionRefusedOperation[],
  alongsideExtensions: boolean,
  invocation: CliInvocation | undefined,
): readonly string[] {
  if (command === 'db migrate') {
    const unapplied = alongsideExtensions
      ? 'For an application migration no database has applied'
      : 'For a migration no database has applied';
    return [
      KEEP_APPLIED_MIGRATION,
      setting === 'accessWidening'
        ? `${unapplied}, delete the migration and any later ones no database has applied, put the contract's access rules back as they were, and plan again.`
        : `${unapplied}, delete the migration and any later ones no database has applied, and plan again: with --rename if a model or field was only renamed, with --convert if its type changed, or after putting back in the contract what the migration removes.`,
    ];
  }
  if (setting === 'accessWidening') {
    return [
      alongsideExtensions
        ? "For the application's operations, keep the contract's access rules as they are."
        : "Keep the contract's access rules as they are.",
    ];
  }
  const changesType = operations.some(({ loss }) => loss === 'typeChange');
  return [
    alongsideExtensions
      ? "For the application's operations: if a model or field was only renamed, state the rename with --rename <old>:<new>."
      : 'If a model or field was only renamed, state the rename with --rename <old>:<new>.',
    ...(changesType
      ? [
          `For a type change, write the conversion with ${cliCommand(
            invocation === undefined ? undefined : { ...invocation, dbGiven: false },
            'migration plan',
            ['--convert', '<field>'],
          )}.`,
        ]
      : []),
    'Otherwise keep it in the contract.',
  ];
}

/** What a user can do instead of a refused change, for the command that refused it and the contract spaces that hold it. */
function keepProtected(
  refusal: DataProtectionRefusal,
  command: DataProtectionCheckedCommand,
  appSpaceId: string,
  invocation: CliInvocation | undefined,
): string {
  const inApp = refusal.operations.filter(({ spaceId }) => spaceId === appSpaceId);
  const extensionSpaces = [
    ...new Set(
      refusal.operations.flatMap(({ spaceId }) => (spaceId === appSpaceId ? [] : [spaceId])),
    ),
  ];
  return [
    refusingPolicy(
      refusal.source,
      refusal.setting === 'accessWidening' ? FORBIDDEN_CHANGE.accessWidening : 'losing data',
    ),
    ...(inApp.length === 0
      ? []
      : keepAppProtected(refusal.setting, command, inApp, extensionSpaces.length > 0, invocation)),
    ...(extensionSpaces.length === 0 ? [] : [extensionsOwnMigrations(extensionSpaces)]),
    doItAnyway(refusal.source),
  ].join(' ');
}

function refusedOperationText(operation: DataProtectionRefusedOperation): string {
  const where =
    operation.migration === undefined
      ? `in contract space "${operation.spaceId}"`
      : `in migration ${operation.migration} of contract space "${operation.spaceId}"`;
  return `${operation.label} (${operation.subject}), ${where}.`;
}

/** `MIGRATION.DATA_PROTECTION_FORBIDS`: a run would lose data, or change who can read or write data, where a setting forbids it. */
export function errorDataProtectionForbids(args: {
  /** The application's contract space; refused operations in any other space are in an extension's. */
  readonly spaceId: string;
  readonly command: DataProtectionCheckedCommand;
  readonly refusals: readonly DataProtectionRefusal[];
  readonly invocation: CliInvocation | undefined;
}): ActionableCliError {
  const { spaceId, command, refusals } = args;
  const refNames = new Set(
    refusals.map(({ source }) => (source.kind === 'ref' ? source.refName : undefined)),
  );
  const [onlyRefName] = refNames;
  const refName = refNames.size === 1 ? onlyRefName : undefined;
  const policyHolder =
    refName === undefined
      ? "This database's data protection policy"
      : `${refName} declares a data protection policy that`;
  const forbidden = refusals.map(({ setting }) => FORBIDDEN_CHANGE[setting]).join(' and ');
  const why = refusals
    .flatMap(({ setting, source, operations }) => [
      `${source.kind === 'ref' ? `${source.refName} declares` : 'The marker records'} ${setting}: ${FORBIDDEN_LEVEL[setting]}.`,
      ...operations.map(refusedOperationText),
    ])
    .join(' ');
  const recoveries = refusals.map((refusal) =>
    keepProtected(refusal, command, spaceId, args.invocation),
  );
  return new ActionableCliError(
    'MIGRATION.DATA_PROTECTION_FORBIDS',
    `${policyHolder} forbids ${forbidden}`,
    {
      why,
      fix: recoveries.join(' '),
      nextActions: recoveries.map(chooseAction),
      meta: {
        spaceId,
        command,
        settings: refusals.map(({ setting }) => ({ setting, level: FORBIDDEN_LEVEL[setting] })),
        operations: refusals.flatMap(({ setting, operations }) =>
          operations.map((operation) => ({ setting, ...operation })),
        ),
      },
    },
  );
}

/**
 * `CLI.INVALID_ARGUMENTS`: consent to write policies was given without a ref whose policies it could
 * write. `command` names the CLI command that was run, whose flags the error names; without it, the
 * error names the control API option `refOption` (`target` for `migrate`, `ref` for `dbUpdate`).
 */
export function errorPermitPolicyChangeNeedsRef(
  args:
    | { readonly command: 'db migrate' | 'db update'; readonly to: string | undefined }
    | { readonly refOption: 'target' | 'ref'; readonly to: string | undefined },
): ActionableCliError {
  const { to } = args;
  const why =
    to === undefined
      ? 'No ref was given, so there are no policies to write.'
      : `${to} is not a ref, so it declares no policies to write.`;
  const toMeta = to === undefined ? {} : { to };
  if ('command' in args) {
    const recovery =
      'Name the ref whose policies to write with --to <ref>, or leave out --permit-policy-change.';
    return new ActionableCliError(
      'CLI.INVALID_ARGUMENTS',
      '--permit-policy-change needs --to <ref>',
      {
        why,
        fix: recovery,
        nextActions: [chooseAction(recovery)],
        meta: { command: args.command, ...toMeta },
      },
    );
  }
  const [summary, recovery] =
    args.refOption === 'target'
      ? [
          'permitPolicyChange needs a target of kind ref',
          'Pass a target of kind ref whose policies to write, or leave out permitPolicyChange.',
        ]
      : [
          'permitPolicyChange needs a ref',
          'Pass the ref whose policies to write, or leave out permitPolicyChange.',
        ];
  return new ActionableCliError('CLI.INVALID_ARGUMENTS', summary, {
    why,
    fix: recovery,
    nextActions: [chooseAction(recovery)],
    meta: toMeta,
  });
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
