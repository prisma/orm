import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { columnExistsAst } from '../../../contract-free/checks';
import { quoteIdentifier } from '../../sql-utils';
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
