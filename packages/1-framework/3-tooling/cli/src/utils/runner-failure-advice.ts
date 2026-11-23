import type {
  BlockingObject,
  MigrationRunnerFailure,
} from '@internal/framework-components/control';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { basename, join } from 'pathe';
import type {
  MigrationPlanArgument,
  MigrationPlanArguments,
} from '../control-api/operations/plan-arguments';
import { statementFlag } from '../control-api/statements/statement-flag';
import type {
  FailedTypeChangeReport,
  RowsFailingCheckReport,
  RowsHoldingValueReport,
  RowsWithoutValueReport,
  RunnerFailureFacts,
} from '../control-api/types';
import { migrateFailedPrecheckAdvice } from './failed-precheck-advice';
import { chooseAction, editFileAction } from './next-actions';
import {
  type CliInvocation,
  cliCommand,
  dbMigrateRerun,
  dbUpdateRerun,
  type PrintedPlan,
  printedPath,
  printedPlan,
  printedWayToTarget,
  quotedPlan,
  selfEmitCommand,
  writtenMigrationRunCommand,
} from './printed-command';
import type { RunnerAdvice } from './runner-advice';
import { schemaCheckIssues } from './schema-check-issues';

/**
 * The written migration of the failed operation: its directory, the contract it starts from, and,
 * when an extension ships it, the extension's contract space.
 */
export interface FailedMigrationOnDisk {
  readonly directory: string;
  /** The `--from` that plans it again once its directory is deleted. */
  readonly replanFrom: MigrationPlanArgument;
  readonly extensionSpaceId?: string;
}

/** What a runner failure says of a type change that failed: who converted the values, and how it failed. */
export function failedTypeChangeText(change: FailedTypeChangeReport): string {
  if (change.by === 'cast') {
    return change.reason === 'noCast'
      ? `The database has no cast from the old type of field "${change.field}" to its new type.`
      : `A value of field "${change.field}" cannot be converted to its new type by the database's cast.`;
  }
  switch (change.reason) {
    case 'value':
      return `The conversion of field "${change.field}" failed on a value its new type cannot hold.`;
    case 'invalidResult':
      return `The conversion of field "${change.field}" left a value its new type cannot hold.`;
    case 'expressionError':
      return `The conversion of field "${change.field}" failed with an error in its expression.`;
  }
}

function quoted(command: string): string {
  return `\`${command}\``;
}

/** A `db migrate` command as advice prints it, for a migration that is not the one the user ran. */
function dbMigrateCommand(invocation: CliInvocation): string {
  return quoted(cliCommand(invocation, 'db migrate'));
}

/** The `db migrate` the user ran, as advice that repeats it prints it. */
function dbMigrateAgain(invocation: CliInvocation): string {
  return quoted(dbMigrateRerun(invocation));
}

/**
 * The steps after filling the migration.ts a `migration plan` wrote with no placeholders: run it,
 * which writes its operations, and apply it with a plain `db migrate`.
 */
export function runWrittenFile(invocation: CliInvocation): string {
  return `run ${quoted(writtenMigrationRunCommand(invocation))} for the directory it writes, and apply it with ${dbMigrateCommand(invocation)}`;
}

/** The step between filling a planned migration.ts and applying it, which writes its operations. */
const RUN_PLANNED_FILE = 'run that migration.ts with the `node` command `migration plan` prints';

/** What advice that plans a migration again says of the statements it was planned with, which the CLI does not store. */
const OTHER_STATEMENTS = 'adding any other statements you planned it with';

function backfillFlags(reports: readonly RowsWithoutValueReport[]): readonly string[] {
  return [
    ...new Set(
      reports.flatMap(({ field }) =>
        field === undefined ? [] : [statementFlag({ verb: 'backfill', text: field })],
      ),
    ),
  ];
}

/** The way out of a cast that met a value it cannot cast without changing the migration: change that value, then `rerun`. */
function changeValueAdvice(change: FailedTypeChangeReport, rerun: string): RunnerAdvice {
  return change.by === 'cast' && change.reason === 'value'
    ? [
        chooseAction(
          `Change the value the failure names so the database's cast accepts it, then re-run ${rerun}`,
        ),
      ]
    : [];
}

/** The way out of a failed cast for `db update`, which plans and applies in one step. */
export function dbUpdateFailedTypeChangeAdvice(
  change: FailedTypeChangeReport,
  migrationPlan: MigrationPlanArguments,
  invocation: CliInvocation,
): RunnerAdvice {
  const changeValue = changeValueAdvice(change, quoted(dbUpdateRerun(invocation)));
  const plan = printedWayToTarget(invocation, migrationPlan, [
    statementFlag({ verb: 'convert', text: change.field }),
  ]);
  if (plan.kind === 'on-disk') {
    return [chooseAction(`${failedTypeChangeText(change)} ${plan.text}`), ...changeValue];
  }
  if (plan.kind === 'none' || plan.kind === 'at-target') {
    return [
      chooseAction(
        `${failedTypeChangeText(change)} No migration can be planned for the change. ${plan.reason}`,
      ),
      ...changeValue,
    ];
  }
  return [
    chooseAction(
      `${failedTypeChangeText(change)} Plan the change with ${quotedPlan(plan)}, write the conversion in the migration.ts it writes, ${plan.afterPlan}`,
    ),
    ...changeValue,
  ];
}

/** The way out of rows without a value for `db update`, which plans and applies in one step. */
export function dbUpdateRowsWithoutValueAdvice(
  reports: readonly RowsWithoutValueReport[],
  migrationPlan: MigrationPlanArguments,
  invocation: CliInvocation,
): RunnerAdvice {
  const flags = backfillFlags(reports);
  const plan = printedWayToTarget(invocation, migrationPlan, flags);
  const planned =
    flags.length === 0
      ? []
      : plan.kind === 'on-disk'
        ? [chooseAction(plan.text)]
        : plan.kind === 'none' || plan.kind === 'at-target'
          ? [chooseAction(`No migration can be planned to backfill those rows. ${plan.reason}`)]
          : [
              chooseAction(
                `Plan it with ${quotedPlan(plan)}, fill the backfill steps in the migration.ts it writes, ${plan.afterPlan}`,
              ),
            ];
  const [first] = reports;
  if (first?.reason === 'nullValues') {
    const keep = optionalFields([first], 'the field');
    return [
      chooseAction(`Set a value in ${theRows(first.rows)}`),
      ...(keep === undefined
        ? []
        : [editFileAction(`Keep ${keep.text} optional in the contract source`)]),
      ...planned,
    ];
  }
  const optional = optionalFields(reports, theFields(reports));
  return [
    ...planned,
    ...(optional === undefined
      ? []
      : [editFileAction(`Make ${optional.text} optional in the contract source`)]),
  ];
}

/**
 * The fields of the reports the contract can make optional, which leaves out discriminators: in the words the caller
 * gives for all of them, or by name when a discriminator is left out. Undefined when every field is a discriminator.
 */
function optionalFields(
  reports: readonly RowsWithoutValueReport[],
  allOfThem: string,
): { readonly text: string; readonly one: boolean } | undefined {
  const optional = reports.filter(({ discriminator }) => !discriminator);
  if (optional.length === 0) {
    return undefined;
  }
  const named = distinct(optional.flatMap(({ field }) => (field === undefined ? [] : [field])));
  if (optional.length === reports.length || named.length === 0) {
    return { text: allOfThem, one: reports.length === 1 };
  }
  const [only] = named;
  return named.length === 1 && only !== undefined
    ? { text: `field "${only}"`, one: true }
    : { text: `fields ${named.map((field) => `"${field}"`).join(', ')}`, one: false };
}

function theFields(reports: readonly RowsWithoutValueReport[]): string {
  const named = new Set(reports.flatMap(({ field }) => (field === undefined ? [] : [field])));
  return named.size > 1 ? 'the fields' : 'the field';
}

function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** The first report of each enum value, in the order the reports name them. */
function onePerEnumValue(
  reports: readonly RowsHoldingValueReport[],
): readonly RowsHoldingValueReport[] {
  return reports.filter(
    (report, index) =>
      reports.findIndex(({ enumValue }) => enumValue === report.enumValue) === index,
  );
}

function renameFlags(reports: readonly RowsHoldingValueReport[]): readonly string[] {
  return onePerEnumValue(reports).map(({ enumValue, enumName }) =>
    statementFlag({ verb: 'rename', text: `${enumValue}:${enumName}.<new member>` }),
  );
}

function deleteFlags(reports: readonly RowsHoldingValueReport[]): readonly string[] {
  return onePerEnumValue(reports).map(({ enumValue }) =>
    statementFlag({ verb: 'delete', text: enumValue }),
  );
}

function newMember(reports: readonly RowsHoldingValueReport[], invocation: CliInvocation): string {
  const enumNames = distinct(reports.map(({ enumName }) => `"${enumName}"`));
  const enums =
    enumNames.length === 1 ? `enum ${enumNames[0]}` : `each of enums ${enumNames.join(', ')}`;
  return `To keep that data under a new enum value, add a member to ${enums} in the contract source, run ${quoted(cliCommand(invocation, 'contract emit'))}`;
}

/** The edits the target gives that keep the data, each call on its own lines as the migration.ts holds it; undefined when it gives none. */
function swapCalls(reports: readonly RowsHoldingValueReport[]): string | undefined {
  const swaps = reports.flatMap(({ keepDataEdit }) =>
    keepDataEdit === undefined
      ? []
      : [`Replace:\n${keepDataEdit.remove}\nwith:\n${keepDataEdit.replaceWith}`],
  );
  return swaps.length === 0 ? undefined : swaps.join('\n');
}

const KEPT_VALUE = 'where <stored value> is a stored value the enum keeps';

/** The run's statements, without the deletes of the enum values that failed. */
function otherStatements(
  invocation: CliInvocation,
  reports: readonly RowsHoldingValueReport[],
): readonly string[] {
  const failed = deleteFlags(reports);
  return (invocation.statementArgs ?? []).filter((flag) => !failed.includes(flag));
}

function storedValuesText(reports: readonly RowsHoldingValueReport[]): string {
  const values = distinct(reports.map(({ value }) => JSON.stringify(value)));
  return values.length === 1
    ? `the stored value ${values[0]} to one the enum keeps`
    : `each of the stored values ${values.join(', ')} to one its enum keeps`;
}

/** The way out when the data of required columns holds stored values `db update` removes. */
export function dbUpdateRowsHoldingValueAdvice(
  reports: readonly RowsHoldingValueReport[],
  migrationPlan: MigrationPlanArguments,
  invocation: CliInvocation,
): RunnerAdvice {
  const others = otherStatements(invocation, reports);
  const deletes = deleteFlags(reports);
  const rename = chooseAction(
    `${newMember(reports, invocation)}, then run ${quoted(cliCommand(invocation, 'db update', [...others, ...renameFlags(reports)]))}`,
  );
  const plan = printedWayToTarget(invocation, migrationPlan, [...others, ...deletes]);
  if (plan.kind === 'on-disk') return [rename, chooseAction(plan.text)];
  if (plan.kind === 'none' || plan.kind === 'at-target') {
    return [
      rename,
      chooseAction(
        `No migration can be planned to keep that data. ${plan.reason}. To keep that data under another stored value, change ${storedValuesText(reports)} in the database yourself, then re-run ${quoted(dbUpdateRerun(invocation, [...others, ...deletes]))}`,
      ),
    ];
  }
  const swaps = swapCalls(reports);
  if (swaps === undefined) return [rename];
  return [
    rename,
    chooseAction(
      `To keep that data by hand, plan the change with ${quotedPlan(plan)}, make the edits below in the migration.ts it writes, ${KEPT_VALUE}, ${plan.afterPlan}.\n${swaps}`,
    ),
  ];
}

function migrateRowsHoldingValueAdvice(
  reports: readonly RowsHoldingValueReport[],
  failedMigration: FailedMigrationText | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const { file, run } = failedMigrationFile(failedMigration);
  const swaps = swapCalls(reports);
  const byHand =
    swaps === undefined
      ? []
      : [
          editFileAction(
            `To keep that data by hand, make the edits below in ${file}, ${KEPT_VALUE}, ${run}, and re-run ${dbMigrateAgain(invocation)}.\n${swaps}`,
          ),
        ];
  if (failedMigration === undefined) return byHand;
  const inPlace =
    swaps === undefined && replacingPlan(failedMigration, renameFlags(reports)).kind === 'none'
      ? [
          editFileAction(
            `To keep that data, add an operation to ${file} that updates the rows holding ${storedValuesList(reports)} to a stored value the enum keeps, before the operation that removes it, ${run}, and re-run ${dbMigrateAgain(invocation)}`,
          ),
        ]
      : [];
  return [
    replan(
      `${newMember(reports, invocation)}, delete`,
      renameFlags(reports),
      failedMigration,
      deleteFlags(reports)
        .map((flag) => `\`${flag}\``)
        .join(' or '),
      `put any code you copied into the migration.ts it writes, ${runWrittenFile(invocation)}`,
    ),
    ...byHand,
    ...inPlace,
  ];
}

function storedValuesList(reports: readonly RowsHoldingValueReport[]): string {
  return distinct(reports.map(({ value }) => JSON.stringify(value))).join(' or ');
}

/** Where the operation that updates the rows goes among the operations of a migration.ts that replaces a check. */
function betweenTheChecks(report: RowsFailingCheckReport, replacedCheck: string): string {
  return `after the operation that drops check "${replacedCheck}" and before the operation that adds check "${report.check}"`;
}

function updateOperation(report: RowsFailingCheckReport): string {
  return `an operation that updates those rows to fit check "${report.check}"`;
}

function fixRowsFirst(report: RowsFailingCheckReport, rerun: string): NextAction {
  return chooseAction(
    `Update or delete those rows so they fit check "${report.check}", then re-run ${quoted(rerun)}`,
  );
}

/** The way out when existing rows fail a check `db update` adds: it cannot keep the data while the check it replaces holds. */
export function dbUpdateRowsFailingCheckAdvice(
  report: RowsFailingCheckReport,
  migrationPlan: MigrationPlanArguments,
  invocation: CliInvocation,
): RunnerAdvice {
  const update = dbUpdateRerun(invocation);
  const { replacedCheck } = report;
  if (replacedCheck === undefined) return [fixRowsFirst(report, update)];
  const cannotKeep = `${quoted(cliCommand(invocation, 'db update'))} cannot keep this data`;
  const plan = printedWayToTarget(invocation, migrationPlan, invocation.statementArgs ?? []);
  if (plan.kind === 'on-disk') return [chooseAction(`${cannotKeep}. ${plan.text}`)];
  if (plan.kind === 'none' || plan.kind === 'at-target') {
    return [
      chooseAction(
        `${cannotKeep}, and no migration can be planned for it. ${plan.reason}. Drop check "${replacedCheck}" in the database yourself, update those rows to fit check "${report.check}", then re-run ${quoted(update)}`,
      ),
    ];
  }
  return [
    chooseAction(
      `${cannotKeep}. Plan the change with ${quotedPlan(plan)}, add ${updateOperation(report)} to the migration.ts it writes, ${betweenTheChecks(report, replacedCheck)}, ${plan.afterPlan}`,
    ),
  ];
}

function migrateRowsFailingCheckAdvice(
  report: RowsFailingCheckReport,
  failedMigration: FailedMigrationText | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const { replacedCheck } = report;
  if (replacedCheck === undefined) {
    return [fixRowsFirst(report, dbMigrateRerun(invocation))];
  }
  const { file, run } = failedMigrationFile(failedMigration);
  return [
    editFileAction(
      `To keep the data, add ${updateOperation(report)} to ${file}, ${betweenTheChecks(report, replacedCheck)}, ${run}, and re-run ${dbMigrateAgain(invocation)}`,
    ),
  ];
}

/**
 * The way out of rows without a value for `db init`: a migration plan needs an origin contract,
 * which a database that `db init` never initialized does not have.
 */
export function dbInitRowsWithoutValueAdvice(
  reports: readonly RowsWithoutValueReport[],
  invocation: CliInvocation,
): RunnerAdvice {
  const field = reports[0]?.field;
  const subject = field === undefined ? 'it' : `field "${field}"`;
  return [
    editFileAction(
      `Make ${subject} optional in the contract source, run ${quoted(cliCommand(invocation, 'db init'))}, then make it required with ${quoted(cliCommand(invocation, 'db update'))}, which says how to give the rows a value`,
    ),
  ];
}

/**
 * A failed migration as the advice names it: its directory relative to where the user ran the
 * CLI, its name, the `node` command that runs its `migration.ts`, and the CLI invocation the other
 * printed commands repeat.
 */
interface FailedMigrationText {
  readonly directory: string;
  readonly name: string;
  /** The `--from` that plans the migration again once its directory is deleted. */
  readonly replanFrom: MigrationPlanArgument;
  readonly nodeCommand: string;
  readonly invocation: CliInvocation;
}

function failedMigrationText(
  failed: FailedMigrationOnDisk,
  invocation: CliInvocation,
): FailedMigrationText {
  const dirName = basename(failed.directory);
  const directory = printedPath(invocation, failed.directory);
  return {
    directory,
    name: dirName.slice(dirName.indexOf('_') + 1),
    replanFrom: failed.replanFrom,
    nodeCommand: selfEmitCommand(invocation, join(failed.directory, 'migration.ts')),
    invocation,
  };
}

/** The `migration plan` that replaces the failed migration once its directory is deleted. */
function replacingPlan(failed: FailedMigrationText, flags: readonly string[]): PrintedPlan {
  return printedPlan(failed.invocation, { from: failed.replanFrom }, [
    '--name',
    failed.name,
    ...flags,
  ]);
}

function keepFailedMigration(failed: FailedMigrationText, reason: string): NextAction {
  return chooseAction(
    `Keep \`${failed.directory}\`: no migration plan can replace it once it is deleted. ${reason}`,
  );
}

/**
 * Planning the failed migration again with `flags`. `opening` is the words before the directory,
 * so the sentence can start the advice or follow why it is needed. When no plan can replace the
 * migration, the advice is to keep it.
 */
function replan(
  opening: string,
  flags: readonly string[],
  failed: FailedMigrationText,
  except: string | undefined = undefined,
  afterPlan = `fill in the migration.ts it writes, ${RUN_PLANNED_FILE}, and run ${dbMigrateAgain(failed.invocation)}`,
): NextAction {
  const plan = replacingPlan(failed, flags);
  if (plan.kind === 'none') return keepFailedMigration(failed, plan.reason);
  const others =
    except === undefined ? OTHER_STATEMENTS : `${OTHER_STATEMENTS} except any ${except}`;
  return chooseAction(
    `${opening} \`${failed.directory}\` (copy any code you wrote in its migration.ts first), plan it again with ${quotedPlan(plan)}, ${others}, ${afterPlan}`,
  );
}

/**
 * Where to fix code written in the failed migration's `migration.ts`, and the command that runs the
 * file again.
 */
function failedMigrationFile(failedMigration: FailedMigrationText | undefined): {
  readonly file: string;
  readonly run: string;
} {
  if (failedMigration === undefined) {
    return { file: 'the migration.ts of the failed migration', run: 'run that file with node' };
  }
  return {
    file: `\`${failedMigration.directory}/migration.ts\``,
    run: `run \`${failedMigration.nodeCommand}\``,
  };
}

function migrateFailedTypeChangeAdvice(
  change: FailedTypeChangeReport,
  failedMigration: FailedMigrationText | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const changeText = failedTypeChangeText(change);
  const { file, run } = failedMigrationFile(failedMigration);
  if (change.by === 'conversion') {
    return [
      editFileAction(
        `${changeText} Fix the conversion in ${file}, ${run}, and re-run ${dbMigrateAgain(invocation)}`,
      ),
    ];
  }
  const convert = statementFlag({ verb: 'convert', text: change.field });
  if (failedMigration === undefined) {
    return [
      chooseAction(
        `${changeText} Find the migration that changes field "${change.field}" with ${quoted(cliCommand(invocation, 'migration list'))}, delete its directory (copy any code you wrote in its migration.ts first), plan it again from the contract it starts from with \`${convert}\`, write the conversion in the migration.ts it writes, ${RUN_PLANNED_FILE}, and apply it with ${dbMigrateAgain(invocation)}`,
      ),
      ...changeValueAdvice(change, dbMigrateAgain(invocation)),
    ];
  }
  const deleted = `\`${statementFlag({ verb: 'delete', text: change.field })}\``;
  return [
    editFileAction(
      `${changeText} ${file} changes field "${change.field}" ${
        change.reason === 'noCast'
          ? 'with a cast the database does not have between these types: replace it'
          : "with the database's cast, which met a value it cannot cast: replace that cast"
      } with your own conversion of the values there, ${run}, and re-run ${dbMigrateAgain(invocation)}`,
    ),
    ...changeValueAdvice(change, dbMigrateAgain(invocation)),
    replan('Delete', [convert], failedMigration, deleted),
  ];
}

function migrateRowsWithoutValueAdvice(
  reports: readonly RowsWithoutValueReport[],
  failedMigration: FailedMigrationText | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const [first] = reports;
  if (first?.reason === 'backfillMissedRows') {
    const { file, run } = failedMigrationFile(failedMigration);
    const step =
      first.field === undefined
        ? 'The backfill step'
        : `The backfill step of field "${first.field}"`;
    return [
      editFileAction(
        `${step} left those rows without a value. Make its run fill every row in ${file}, ${run}, and re-run ${dbMigrateAgain(invocation)}`,
      ),
    ];
  }
  const flags = backfillFlags(reports);
  const again = (opening: string) =>
    flags.length === 0 || failedMigration === undefined
      ? undefined
      : replan(opening, flags, failedMigration);
  const replaceable =
    failedMigration !== undefined && replacingPlan(failedMigration, flags).kind !== 'none';
  const one = reports.length === 1;
  if (reports.every(({ reason }) => reason === 'nullValues')) {
    const rerun = chooseAction(
      one
        ? `Set a value in ${theRows(first?.rows ?? 0)} and re-run ${dbMigrateAgain(invocation)}`
        : `Set a value in the rows that hold NULL in each of ${fieldList(reports)} and re-run ${dbMigrateAgain(invocation)}`,
    );
    const backfill = again('Delete');
    const fields = optionalFields(reports, one ? 'the field' : 'those fields');
    const keep =
      fields === undefined
        ? []
        : [
            failedMigration === undefined
              ? editFileAction(
                  `Keep ${fields.text} optional in the contract source, and plan the migration again`,
                )
              : keepOptional(fields.text, fields.one ? 'it' : 'them', failedMigration, invocation),
          ].filter((action) => action !== undefined);
    return [rerun, ...(backfill === undefined ? [] : [backfill]), ...keep];
  }
  const unreplaceable = failedMigration !== undefined && !replaceable;
  if (first?.reason === 'nullValues') {
    const notEnough =
      'The migration also adds a required field the existing rows have no value for, so setting values is not enough.';
    const backfill = again(`${notEnough} Delete`);
    if (backfill !== undefined && replaceable) {
      return [backfill];
    }
    if (unreplaceable) {
      const newFields = reports.filter(({ reason }) => reason === 'newField');
      return [
        ...(backfill === undefined ? [] : [backfill]),
        editFileAction(
          `${notEnough} Set a value in the rows that hold NULL, and ${fillInPlace(newFields, failedMigration, invocation)}`,
        ),
      ];
    }
    const newFields = optionalFields(
      reports.filter(({ reason }) => reason === 'newField'),
      'the new fields',
    );
    return [
      ...(backfill === undefined ? [] : [backfill]),
      newFields === undefined
        ? resolveTheCause(invocation)
        : editFileAction(
            `${notEnough} Make ${newFields.text} optional in the contract source, and plan the migration again`,
          ),
    ];
  }
  const fields = theFields(reports);
  const required = again(`To keep ${fields} required, delete`);
  if (unreplaceable && required !== undefined) {
    return [
      required,
      editFileAction(
        `To keep ${fields} required, ${fillInPlace(reports, failedMigration, invocation)}`,
      ),
    ];
  }
  const optional = optionalFields(reports, fields);
  if (required === undefined) {
    return [
      optional === undefined
        ? resolveTheCause(invocation)
        : editFileAction(
            `Make ${optional.text} optional in the contract source, and plan the migration again`,
          ),
    ];
  }
  return [
    required,
    ...(optional === undefined
      ? []
      : [
          editFileAction(
            `Make ${optional.text} optional in the contract source, and plan it again`,
          ),
        ]),
  ];
}

/**
 * Giving the rows of new required fields a value in the failed migration itself, for when no plan
 * can replace it: the shape `migration plan --backfill` writes, made by hand.
 */
function fillInPlace(
  reports: readonly RowsWithoutValueReport[],
  failedMigration: FailedMigrationText,
  invocation: CliInvocation,
): string {
  const { file, run } = failedMigrationFile(failedMigration);
  const flags = backfillFlags(reports)
    .map((flag) => `\`${flag}\``)
    .join(' ');
  const shape = flags === '' ? '`migration plan --backfill`' : `\`migration plan\` with ${flags}`;
  const field = reports.length === 1 ? 'the field' : 'each field';
  return `give the existing rows a value for ${fieldList(reports)} in the migration itself, in the shape ${shape} writes: add ${field} as optional, fill it with a data transform, and only then make it required. Make that change in ${file}, ${run}, and re-run ${dbMigrateAgain(invocation)}`;
}

/**
 * The way out of a failed migration an extension ships: its migrations come with the extension, and
 * `migration plan` plans only the application's contract space.
 */
function extensionMigrationAdvice(spaceId: string, invocation: CliInvocation): RunnerAdvice {
  return [
    resolveTheCause(invocation),
    chooseAction(
      `The failed migration belongs to extension space "${spaceId}", whose migrations come with the extension and \`migration plan\` does not plan, so do not edit or plan it again; ask the extension's author for a version whose migrations apply to this database`,
    ),
  ];
}

function resolveTheCause(invocation: CliInvocation): NextAction {
  return chooseAction(
    `Resolve the cause the failure names, then re-run ${dbMigrateAgain(invocation)}`,
  );
}

/** Keeping `fields` optional by planning the failed migration again; none when no plan can replace it. */
function keepOptional(
  fields: string,
  pronoun: string,
  failedMigration: FailedMigrationText,
  invocation: CliInvocation,
): NextAction | undefined {
  const plan = replacingPlan(failedMigration, []);
  if (plan.kind === 'none') return undefined;
  return editFileAction(
    `Keep ${fields} optional: make ${pronoun} optional in the contract source again, delete \`${failedMigration.directory}\` (copy any code you wrote in its migration.ts first), and plan it again with ${quotedPlan(plan)}, ${OTHER_STATEMENTS}, put back any code you copied, ${RUN_PLANNED_FILE}, and apply it with ${dbMigrateCommand(invocation)}`,
  );
}

function theRows(rows: number): string {
  return rows === 1 ? 'that row' : `those ${rows} rows`;
}

function fieldList(reports: readonly RowsWithoutValueReport[]): string {
  return reports
    .map(({ field }) => (field === undefined ? undefined : `"${field}"`))
    .filter((field) => field !== undefined)
    .join(', ');
}

function migrateSchemaCheckAdvice(
  failedMigration: FailedMigrationText | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const emit = quoted(cliCommand(invocation, 'contract emit'));
  if (failedMigration === undefined) {
    return [
      editFileAction(
        `If the contract source does not describe the schema you want, change it to resolve the issues listed, re-run ${emit}, and run ${quoted(cliCommand(invocation, 'migration status'))}. If it prints a \`migration plan\`, run it, ${RUN_PLANNED_FILE}, and run ${dbMigrateAgain(invocation)}; otherwise run the command it prints`,
      ),
      editFileAction(
        `If a migration you edited by hand does not reach its destination contract, find it with ${quoted(cliCommand(invocation, 'migration list'))}, change its operations to resolve the issues listed, run its migration.ts with \`node\`, and run ${dbMigrateAgain(invocation)}`,
      ),
    ];
  }
  const { file, run } = failedMigrationFile(failedMigration);
  const fixMigration = editFileAction(
    `If ${file} does not reach its destination contract, for example after a hand edit, change its operations to resolve the issues listed, ${run}, and run ${dbMigrateAgain(invocation)}`,
  );
  const plan = replacingPlan(failedMigration, []);
  if (plan.kind === 'none')
    return [keepFailedMigration(failedMigration, plan.reason), fixMigration];
  return [
    editFileAction(
      `If the contract source does not describe the schema you want, change it to resolve the issues listed, re-run ${emit}, delete \`${failedMigration.directory}\` (copy any code you wrote in its migration.ts first), plan it again with ${quotedPlan(plan)}, put any code you copied into the migration.ts it writes, ${RUN_PLANNED_FILE}, and run ${dbMigrateCommand(invocation)}`,
    ),
    fixMigration,
  ];
}

/** The way out when objects in the database keep an operation from running. */
export function blockingObjectsAdvice(
  objects: readonly BlockingObject[],
  rerun: string,
): RunnerAdvice {
  const named = objects.map(({ kind, name }) => `${kind} ${name}`);
  const listed =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
  return [
    chooseAction(`Drop or change ${listed} in the database yourself, then re-run \`${rerun}\``),
  ];
}

/**
 * The way out of a failed `db migrate` apply: every path and command it prints works from where the
 * CLI ran, with the `--config` it was given.
 */
export function migrateAdvice(
  failure: MigrationRunnerFailure,
  facts: RunnerFailureFacts,
  failedOnDisk: FailedMigrationOnDisk | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const failedMigration =
    failedOnDisk === undefined ? undefined : failedMigrationText(failedOnDisk, invocation);
  const { blockingObjects } = failure.meta;
  if (blockingObjects !== undefined) {
    return blockingObjectsAdvice(blockingObjects, dbMigrateRerun(invocation));
  }
  if (failedOnDisk?.extensionSpaceId !== undefined) {
    return extensionMigrationAdvice(failedOnDisk.extensionSpaceId, invocation);
  }
  if (facts.failedTypeChange !== undefined) {
    return migrateFailedTypeChangeAdvice(facts.failedTypeChange, failedMigration, invocation);
  }
  if (facts.rowsWithoutValue !== undefined) {
    return migrateRowsWithoutValueAdvice(facts.rowsWithoutValue, failedMigration, invocation);
  }
  if (facts.rowsHoldingValue !== undefined) {
    return migrateRowsHoldingValueAdvice(facts.rowsHoldingValue, failedMigration, invocation);
  }
  if (facts.rowsFailingCheck !== undefined) {
    return migrateRowsFailingCheckAdvice(facts.rowsFailingCheck, failedMigration, invocation);
  }
  if (schemaCheckIssues(failure) !== undefined) {
    return migrateSchemaCheckAdvice(failedMigration, invocation);
  }
  if (facts.failedPrecheck !== undefined) {
    return migrateFailedPrecheckAdvice(facts.failedPrecheck, invocation);
  }
  return [resolveTheCause(invocation)];
}
