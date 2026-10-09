import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { columnExistsAst, columnNameTakenAst } from '../../../contract-free/checks';
import { quoteIdentifier } from '../../sql-utils';
import { sqliteIdentifiersCollide } from '../identifier-case';
import { buildTargetDetails } from '../planner-target-details';
import {
  type Op,
  refuseEarlierColumnSpecs,
  renderSpecDefault,
  type SqliteColumnSpec,
  step,
} from './shared';

export function addColumnExecuteSql(
  tableName: string,
  column: SqliteColumnSpec,
  defaultClause: string,
): string {
  const parts = [
    `ALTER TABLE ${quoteIdentifier(tableName)}`,
    `ADD COLUMN ${quoteIdentifier(column.name)} ${column.typeSql}`,
    defaultClause,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}

export function dropColumnExecuteSql(tableName: string, columnName: string): string {
  return `ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)}`;
}

export async function addColumn(
  tableName: string,
  column: SqliteColumnSpec,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  refuseEarlierColumnSpecs('addColumn', tableName, [column]);
  const defaultClause = await renderSpecDefault(column, tableName, lowerer);
  const checks = columnExistsAst(tableName, column.name);
  const absent = await lowerer.lowerToExecuteRequest(checks.columnAbsent());
  const present = await lowerer.lowerToExecuteRequest(checks.columnPresent());
  return {
    id: `column.${tableName}.${column.name}`,
    label: `Add column ${column.name} on ${tableName}`,
    summary: `Adds column ${column.name} on ${tableName}`,
    operationClass: 'additive',
    target: { id: 'sqlite', details: buildTargetDetails('column', column.name, tableName) },
    precheck: [step(`ensure column "${column.name}" is missing`, absent.sql, absent.params)],
    execute: [
      step(`add column "${column.name}"`, addColumnExecuteSql(tableName, column, defaultClause)),
    ],
    postcheck: [step(`verify column "${column.name}" exists`, present.sql, present.params)],
  };
}

export async function dropColumn(
  tableName: string,
  columnName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const checks = columnExistsAst(tableName, columnName);
  const present = await lowerer.lowerToExecuteRequest(checks.columnPresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.columnAbsent());
  return {
    id: `dropColumn.${tableName}.${columnName}`,
    label: `Drop column ${columnName} on ${tableName}`,
    summary: `Drops column ${columnName} on ${tableName} which is not in the contract`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [
      step(`ensure column "${columnName}" exists on "${tableName}"`, present.sql, present.params),
    ],
    execute: [
      step(
        `drop column "${columnName}" from "${tableName}"`,
        dropColumnExecuteSql(tableName, columnName),
      ),
    ],
    postcheck: [
      step(`verify column "${columnName}" is gone from "${tableName}"`, absent.sql, absent.params),
    ],
  };
}

export function renameColumnExecuteSql(
  tableName: string,
  fromName: string,
  toName: string,
): string {
  return `ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(fromName)} TO ${quoteIdentifier(toName)}`;
}

/**
 * Renames a column. SQLite updates the indexes, foreign keys and triggers that name it, and keeps
 * index names. SQLite takes names that differ only in case for the same name, so the new name
 * must be free whatever its case, except in a rename that only changes case, which SQLite performs
 * in one statement.
 */
export function renameColumnOperationId(tableName: string, fromName: string): string {
  return `renameColumn.${tableName}.${fromName}`;
}

export async function renameColumn(
  tableName: string,
  fromName: string,
  toName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const fromChecks = columnExistsAst(tableName, fromName);
  const toChecks = columnExistsAst(tableName, toName);
  const fromPresent = await lowerer.lowerToExecuteRequest(fromChecks.columnPresent());
  const toAbsent = await lowerer.lowerToExecuteRequest(
    sqliteIdentifiersCollide(fromName, toName)
      ? toChecks.columnAbsent()
      : columnNameTakenAst(tableName, toName).nameFree(),
  );
  const toPresent = await lowerer.lowerToExecuteRequest(toChecks.columnPresent());
  const fromAbsent = await lowerer.lowerToExecuteRequest(fromChecks.columnAbsent());
  return {
    id: renameColumnOperationId(tableName, fromName),
    label: `Rename column ${fromName} on ${tableName} to ${toName}`,
    summary: `Renames column ${fromName} on ${tableName} to ${toName}, keeping its values`,
    operationClass: 'widening',
    target: { id: 'sqlite', details: buildTargetDetails('column', toName, tableName) },
    precheck: [
      step(
        `ensure column "${fromName}" exists on "${tableName}"`,
        fromPresent.sql,
        fromPresent.params,
      ),
      step(
        `ensure column "${toName}" does not exist on "${tableName}"`,
        toAbsent.sql,
        toAbsent.params,
      ),
    ],
    execute: [
      step(
        `rename column "${fromName}" on "${tableName}" to "${toName}"`,
        renameColumnExecuteSql(tableName, fromName, toName),
      ),
    ],
    postcheck: [
      step(`verify column "${toName}" exists on "${tableName}"`, toPresent.sql, toPresent.params),
      step(
        `verify column "${fromName}" no longer exists on "${tableName}"`,
        fromAbsent.sql,
        fromAbsent.params,
      ),
    ],
  };
}
