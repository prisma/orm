import {
  type ChangeStrategy,
  type DatabasePolicies,
  type DatabasePolicyDifference,
  databasePolicyValueText,
  type MigrationDataLossKind,
  movedDatabasePoliciesWhy,
} from '@internal/framework-components/control';
import { shellQuoted } from '../control-api/statements/statement-flag';
import { ActionableCliError } from './cli-errors';
import { type DataProtectionSetting, FORBIDDEN_LEVEL } from './data-protection-settings';
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
  const recovery = `Author a migration with ${cliCommand(invocation, 'migration plan')}, then apply it with ${migrate}.`;
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

const EXTENSION_OWNS_MIGRATION =
  "A migration in an extension's contract space belongs to that extension, so do not edit or delete it; ask the extension's author for a version without the operation.";

/** Advice for the refused migrations `db migrate` would apply: the application's may be changed, an extension's may not. */
function keepMigrationsProtected(
  refusal: DataProtectionRefusal,
  appSpaceId: string,
  appMigrationAdvice: string,
): readonly string[] {
  const inApp = refusal.operations.some(({ spaceId }) => spaceId === appSpaceId);
  const inExtension = refusal.operations.some(({ spaceId }) => spaceId !== appSpaceId);
  return [
    ...(inApp ? [KEEP_APPLIED_MIGRATION, appMigrationAdvice] : []),
    ...(inExtension ? [EXTENSION_OWNS_MIGRATION] : []),
  ];
}

/** What a user can do instead of a refused change, for the command that refused it. */
function keepProtected(
  refusal: DataProtectionRefusal,
  command: DataProtectionCheckedCommand,
  appSpaceId: string,
  invocation: CliInvocation | undefined,
): string {
  const migrated = command === 'db migrate';
  if (refusal.setting === 'accessWidening') {
    return [
      refusingPolicy(refusal.source, FORBIDDEN_CHANGE.accessWidening),
      ...(migrated
        ? keepMigrationsProtected(
            refusal,
            appSpaceId,
            'For a migration no database has applied, remove the operation from the migration.',
          )
        : ["Keep the contract's access rules as they are."]),
      doItAnyway(refusal.source),
    ].join(' ');
  }
  const changesType = refusal.operations.some(({ loss }) => loss === 'typeChange');
  return [
    refusingPolicy(refusal.source, 'losing data'),
    ...(migrated
      ? keepMigrationsProtected(
          refusal,
          appSpaceId,
          'For a migration no database has applied: if a model or field was only renamed or its type changed, delete the migration and plan it again with --rename or --convert; otherwise remove the operation from the migration.',
        )
      : [
          'If a model or field was only renamed, state the rename with --rename <old>:<new>.',
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
        ]),
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
