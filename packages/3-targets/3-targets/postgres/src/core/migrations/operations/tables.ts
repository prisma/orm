import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { tableExistsAst } from '../../../contract-free/checks';
import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

export async function dropTable(
  schemaName: string,
  tableName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const checks = tableExistsAst(schemaName, tableName);
  const present = await lowerer.lowerToExecuteRequest(checks.tablePresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.tableAbsent());
  return {
    id: `dropTable.${tableName}`,
    label: `Drop table "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('table', tableName, schemaName),
    precheck: [step(`ensure table "${tableName}" exists`, present.sql, present.params)],
    execute: [step(`drop table "${tableName}"`, `DROP TABLE ${qualified}`)],
    postcheck: [step(`verify table "${tableName}" does not exist`, absent.sql, absent.params)],
  };
}

export function renameTableStatement(schemaName: string, fromName: string, toName: string): string {
  return `ALTER TABLE ${qualifyTableName(schemaName, fromName)} RENAME TO ${quoteIdentifier(toName)}`;
}

export async function renameTable(
  schemaName: string,
  fromName: string,
  toName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const fromChecks = tableExistsAst(schemaName, fromName);
  const toChecks = tableExistsAst(schemaName, toName);
  const fromPresent = await lowerer.lowerToExecuteRequest(fromChecks.tablePresent());
  const toAbsent = await lowerer.lowerToExecuteRequest(toChecks.tableAbsent());
  const toPresent = await lowerer.lowerToExecuteRequest(toChecks.tablePresent());
  const fromAbsent = await lowerer.lowerToExecuteRequest(fromChecks.tableAbsent());
  return {
    id: `renameTable.${fromName}`,
    label: `Rename table "${fromName}" to "${toName}"`,
    operationClass: 'widening',
    target: targetDetails('table', toName, schemaName),
    precheck: [
      step(`ensure table "${fromName}" exists`, fromPresent.sql, fromPresent.params),
      step(`ensure table "${toName}" does not exist`, toAbsent.sql, toAbsent.params),
    ],
    execute: [
      step(
        `rename table "${fromName}" to "${toName}"`,
        renameTableStatement(schemaName, fromName, toName),
      ),
    ],
    // Both postchecks: the runner skips an operation whose postcheck already
    // holds, and "the new table exists" alone would skip a rename that never
    // happened when both tables exist.
    postcheck: [
      step(`verify table "${toName}" exists`, toPresent.sql, toPresent.params),
      step(`verify table "${fromName}" no longer exists`, fromAbsent.sql, fromAbsent.params),
    ],
  };
}
