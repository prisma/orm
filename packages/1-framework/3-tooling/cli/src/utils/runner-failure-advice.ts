import type {
  BlockingObject,
  KeepDataEdit,
  MigrationRunnerFailure,
} from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { basename, join } from 'pathe';
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
  printedPath,
  printedPlanCommand,
  selfEmitCommand,
  writtenMigrationRunCommand,
} from './printed-command';
import type { RunnerAdvice } from './runner-advice';
import { schemaCheckIssues } from './schema-check-issues';

/** The written migration of the failed operation: its directory, and the contract it starts from. */
export interface FailedMigrationOnDisk {
  readonly directory: string;
  readonly from: string;
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

/** A `db migrate` command as advice prints it. */
function dbMigrateCommand(invocation: CliInvocation): string {
  return quoted(cliCommand(invocation, 'db migrate'));
}

/** The steps after filling the migration.ts a `migration plan` wrote with no placeholders: run it, which writes its operations, and apply it. */
export function runWrittenFile(invocation: CliInvocation): string {
  return `run ${quoted(writtenMigrationRunCommand(invocation))} for the directory it writes, and apply it with ${dbMigrateCommand(invocation)}`;
}

/** The step between filling a planned migration.ts and applying it, which writes its operations. */
export const RUN_PLANNED_FILE =
  'run that migration.ts with the `node` command `migration plan` prints';

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

/** The way out of a failed cast for `db update`, which plans and applies in one step. */
export function dbUpdateFailedTypeChangeAdvice(
  change: FailedTypeChangeReport,
  databaseStorageHash: string | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const plan = printedPlanCommand(invocation, databaseStorageHash, [
    statementFlag({ verb: 'convert', text: change.field }),
  ]);
  return [
    chooseAction(
      `${failedTypeChangeText(change)} Plan the change with ${quoted(plan)}, write the conversion in the migration.ts it writes, ${RUN_PLANNED_FILE}, and apply it with ${dbMigrateCommand(invocation)}`,
    ),
  ];
}

/** The way out of rows without a value for `db update`, which plans and applies in one step. */
export function dbUpdateRowsWithoutValueAdvice(
  reports: readonly RowsWithoutValueReport[],
  databaseStorageHash: string | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const flags = backfillFlags(reports);
  const planned =
    flags.length === 0
      ? []
      : [
          chooseAction(
            `Plan it with ${quoted(printedPlanCommand(invocation, databaseStorageHash, flags))}, fill the backfill steps in the migration.ts it writes, ${RUN_PLANNED_FILE}, and apply it with ${dbMigrateCommand(invocation)}`,
          ),
        ];
  const [first] = reports;
  if (first?.reason === 'nullValues') {
    return [
      chooseAction(`Set a value in ${theRows(first.rows)}`),
      editFileAction('Keep the field optional in the contract source'),
      ...planned,
    ];
  }
  return [...planned, editFileAction('Make the field optional in the contract source')];
}

function renameToNewMember(report: RowsHoldingValueReport): string {
  return statementFlag({
    verb: 'rename',
    text: `${report.enumValue}:${report.enumName}.<new member>`,
  });
}

function newMember(report: RowsHoldingValueReport, invocation: CliInvocation): string {
  return `To keep that data under a new enum value, add a member to enum "${report.enumName}" in the contract source, run ${quoted(cliCommand(invocation, 'contract emit'))}`;
}

/** The edit the target gives that keeps the data, as the advice writes it. */
function swapCalls(edit: KeepDataEdit): string {
  return `replace ${edit.remove} with ${edit.replaceWith}`;
}

const KEPT_VALUE = 'where "<stored value>" is a stored value the enum keeps';

/** The run's statements, without the delete of `enumValue` that failed. */
function otherStatements(invocation: CliInvocation, enumValue: string): readonly string[] {
  const failed = statementFlag({ verb: 'delete', text: enumValue });
  return (invocation.statementArgs ?? []).filter((flag) => flag !== failed);
}

/** The way out when a required column's data holds a stored value `db update` removes. */
export function dbUpdateRowsHoldingValueAdvice(
  report: RowsHoldingValueReport,
  databaseStorageHash: string | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const others = otherStatements(invocation, report.enumValue);
  const deleteFlag = statementFlag({ verb: 'delete', text: report.enumValue });
  const rename = chooseAction(
    `${newMember(report, invocation)}, then run ${quoted(cliCommand(invocation, 'db update', [...others, renameToNewMember(report)]))}`,
  );
  if (databaseStorageHash === undefined) {
    return [
      rename,
      chooseAction(
        `To keep that data under another stored value, change the stored value ${JSON.stringify(report.value)} to one the enum keeps in the database yourself, then re-run ${quoted(cliCommand(invocation, 'db update', [...others, deleteFlag]))}`,
      ),
    ];
  }
  const { keepDataEdit } = report;
  if (keepDataEdit === undefined) return [rename];
  const plan = printedPlanCommand(invocation, databaseStorageHash, [...others, deleteFlag]);
  return [
    rename,
    chooseAction(
      `To keep that data by hand, plan the change with ${quoted(plan)}, ${swapCalls(keepDataEdit)} in the migration.ts it writes, ${KEPT_VALUE}, ${runWrittenFile(invocation)}`,
    ),
  ];
}

function migrateRowsHoldingValueAdvice(
  report: RowsHoldingValueReport,
  failedMigration: FailedMigrationText | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const { file, run } = failedMigrationFile(failedMigration);
  const { keepDataEdit } = report;
  const byHand =
    keepDataEdit === undefined
      ? []
      : [
          editFileAction(
            `To keep that data by hand, ${swapCalls(keepDataEdit)} in ${file}, ${KEPT_VALUE}, ${run}, and re-run ${dbMigrateCommand(invocation)}`,
          ),
        ];
  if (failedMigration === undefined) return byHand;
  return [
    replan(
      `${newMember(report, invocation)}, delete`,
      [renameToNewMember(report)],
      failedMigration,
      `\`${statementFlag({ verb: 'delete', text: report.enumValue })}\``,
      `put any code you copied into the migration.ts it writes, ${runWrittenFile(invocation)}`,
    ),
    ...byHand,
  ];
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
  databaseStorageHash: string | undefined,
  invocation: CliInvocation,
): RunnerAdvice {
  const update = cliCommand(invocation, 'db update', invocation.rerunArgs ?? []);
  const { replacedCheck } = report;
  if (replacedCheck === undefined) return [fixRowsFirst(report, update)];
  const cannotKeep = `${quoted(cliCommand(invocation, 'db update'))} cannot keep this data`;
  if (databaseStorageHash === undefined) {
    return [
      chooseAction(
        `${cannotKeep}, and no migration ends at the contract the database is at, so ${quoted(cliCommand(invocation, 'migration plan'))} cannot plan from it. Drop check "${replacedCheck}" in the database yourself, update those rows to fit check "${report.check}", then re-run ${quoted(update)}`,
      ),
    ];
  }
  const plan = printedPlanCommand(invocation, databaseStorageHash, invocation.statementArgs ?? []);
  return [
    chooseAction(
      `${cannotKeep}. Plan the change with ${quoted(plan)}, add ${updateOperation(report)} to the migration.ts it writes, ${betweenTheChecks(report, replacedCheck)}, ${runWrittenFile(invocation)}`,
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
    return [fixRowsFirst(report, cliCommand(invocation, 'db migrate', invocation.rerunArgs ?? []))];
  }
  const { file, run } = failedMigrationFile(failedMigration);
  return [
    editFileAction(
      `To keep the data, add ${updateOperation(report)} to ${file}, ${betweenTheChecks(report, replacedCheck)}, ${run}, and re-run ${dbMigrateCommand(invocation)}`,
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
  /** The contract the migration starts from, or `undefined` for the empty contract, which `migration plan` takes as its default origin and does not accept as `--from`. */
  readonly from: string | undefined;
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
    from: failed.from === EMPTY_CONTRACT_HASH ? undefined : failed.from,
    nodeCommand: selfEmitCommand(invocation, join(failed.directory, 'migration.ts')),
    invocation,
  };
}

/**
 * Planning the failed migration again with `flags`. `opening` is the words before the directory,
 * so the sentence can start the advice or follow why it is needed.
 */
function replan(
  opening: string,
  flags: readonly string[],
  failed: FailedMigrationText,
  except: string | undefined = undefined,
  afterPlan = `fill in the migration.ts it writes, ${RUN_PLANNED_FILE}, and run ${dbMigrateCommand(failed.invocation)}`,
): NextAction {
  const others =
    except === undefined ? OTHER_STATEMENTS : `${OTHER_STATEMENTS} except any ${except}`;
  const plan = printedPlanCommand(failed.invocation, failed.from, [
    '--name',
    failed.name,
    ...flags,
  ]);
  return chooseAction(
    `${opening} \`${failed.directory}\` (copy any code you wrote in its migration.ts first), plan it again with ${quoted(plan)}, ${others}, ${afterPlan}`,
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
        `${changeText} Fix the conversion in ${file}, ${run}, and re-run ${dbMigrateCommand(invocation)}`,
      ),
    ];
  }
  const convert = statementFlag({ verb: 'convert', text: change.field });
  if (failedMigration === undefined) {
    return [
      chooseAction(
        `${changeText} Plan the type change again with ${quoted(printedPlanCommand(invocation, undefined, [convert]))}, write the conversion in the migration.ts it writes, ${RUN_PLANNED_FILE}, and apply it with ${dbMigrateCommand(invocation)}`,
      ),
    ];
  }
  const deleted = `\`${statementFlag({ verb: 'delete', text: change.field })}\``;
  return [
    editFileAction(
      `${changeText} ${file} has no conversion for field "${change.field}": write one there, ${run}, and re-run ${dbMigrateCommand(invocation)}`,
    ),
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
        `${step} left those rows without a value. Make its run fill every row in ${file}, ${run}, and re-run ${dbMigrateCommand(invocation)}`,
      ),
    ];
  }
  const flags = backfillFlags(reports);
  const again = (opening: string) =>
    flags.length === 0 || failedMigration === undefined
      ? undefined
      : replan(opening, flags, failedMigration);
  const one = reports.length === 1;
  if (reports.every(({ reason }) => reason === 'nullValues')) {
    const rerun = chooseAction(
      one
        ? `Set a value in ${theRows(first?.rows ?? 0)} and re-run ${dbMigrateCommand(invocation)}`
        : `Set a value in the rows that hold NULL in each of ${fieldList(reports)} and re-run ${dbMigrateCommand(invocation)}`,
    );
    const backfill = again('Delete');
    const fields = one ? 'the field' : 'those fields';
    const keep =
      failedMigration === undefined
        ? editFileAction(
            `Keep ${fields} optional in the contract source, and plan the migration again`,
          )
        : keepOptional(fields, one ? 'it' : 'them', failedMigration, invocation);
    return [rerun, ...(backfill === undefined ? [] : [backfill]), keep];
  }
  if (first?.reason === 'nullValues') {
    const notEnough =
      'The migration also adds a required field the existing rows have no value for, so setting values is not enough.';
    const backfill = again(`${notEnough} Delete`);
    return [
      backfill ??
        editFileAction(
          `${notEnough} Make the new fields optional in the contract source, and plan the migration again`,
        ),
    ];
  }
  const required = again('To keep the field required, delete');
  return required === undefined
    ? [
        editFileAction(
          'Make the field optional in the contract source, and plan the migration again',
        ),
      ]
    : [
        required,
        editFileAction('Make the field optional in the contract source, and plan it again'),
      ];
}

function keepOptional(
  fields: string,
  pronoun: string,
  failedMigration: FailedMigrationText,
  invocation: CliInvocation,
): NextAction {
  const plan = printedPlanCommand(invocation, failedMigration.from, [
    '--name',
    failedMigration.name,
  ]);
  return editFileAction(
    `Keep ${fields} optional: make ${pronoun} optional in the contract source again, delete \`${failedMigration.directory}\` (copy any code you wrote in its migration.ts first), and plan it again with ${quoted(plan)}, ${OTHER_STATEMENTS}, put back any code you copied, ${RUN_PLANNED_FILE}, and apply it with ${dbMigrateCommand(invocation)}`,
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
  const plan = printedPlanCommand(
    invocation,
    failedMigration?.from,
    failedMigration === undefined ? [] : ['--name', failedMigration.name],
  );
  const directory =
    failedMigration === undefined
      ? "the failed migration's directory"
      : `\`${failedMigration.directory}\``;
  const { file, run } = failedMigrationFile(failedMigration);
  return [
    editFileAction(
      `If the contract source does not describe the schema you want, change it to resolve the issues listed, re-run ${emit}, delete ${directory} (copy any code you wrote in its migration.ts first), plan it again with ${quoted(plan)}, put any code you copied into the migration.ts it writes, ${RUN_PLANNED_FILE}, and run ${dbMigrateCommand(invocation)}`,
    ),
    editFileAction(
      `If ${file} does not reach its destination contract, for example after a hand edit, change its operations to resolve the issues listed, ${run}, and run ${dbMigrateCommand(invocation)}`,
    ),
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
    return blockingObjectsAdvice(
      blockingObjects,
      cliCommand(invocation, 'db migrate', invocation.rerunArgs ?? []),
    );
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
  return [
    chooseAction(
      `Fix the issue and re-run \`${cliCommand(invocation, 'db migrate', ['--to', '<contract>'])}\``,
    ),
  ];
}
