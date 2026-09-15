import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { DdlColumn } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import {
  columnDefaultAst,
  columnExistsAst,
  columnNullabilityAst,
  columnTypeAst,
  noNullValuesAst,
  tableIsEmptyAst,
} from '../../../contract-free/checks';
import * as contractFreeDdl from '../../../contract-free/ddl';
import { quoteIdentifier } from '../../sql-utils';
import { boundSchema } from '../bound-schema';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

type CheckStep = { sql: string; params?: readonly unknown[] };

async function columnExistsSteps(
  lowerer: ExecuteRequestLowerer,
  options: { schema: string; table: string; column: string },
): Promise<{ present: CheckStep; absent: CheckStep }> {
  const checks = columnExistsAst(options);
  const present = await lowerer.lowerToExecuteRequest(checks.columnPresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.columnAbsent());
  return { present, absent };
}

export async function dropColumn(
  schemaName: string,
  tableName: string,
  columnName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const { present, absent } = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: columnName,
  });
  return {
    id: `dropColumn.${tableName}.${columnName}`,
    label: `Drop column "${columnName}" from "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [step(`ensure column "${columnName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `drop column "${columnName}"`,
        `ALTER TABLE ${qualified} DROP COLUMN ${quoteIdentifier(columnName)}`,
      ),
    ],
    postcheck: [step(`verify column "${columnName}" does not exist`, absent.sql, absent.params)],
  };
}

/**
 * `qualifiedTargetType` is the new column type as it appears in the
 * `ALTER COLUMN TYPE` clause (schema-qualified for user-defined types, raw
 * native name for built-ins). `formatTypeExpected` is the unqualified
 * `format_type` form used in the postcheck. `rawTargetTypeForLabel` is the
 * string appearing in the human-readable label (typically `toType` when
 * explicit, else the column's native type).
 */
export async function alterColumnType(
  schemaName: string,
  tableName: string,
  columnName: string,
  options: {
    readonly qualifiedTargetType: string;
    readonly formatTypeExpected: string;
    readonly rawTargetTypeForLabel: string;
    readonly using?: string;
  },
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const usingClause = options.using
    ? ` USING ${options.using}`
    : ` USING ${quoteIdentifier(columnName)}::${options.qualifiedTargetType}`;
  const { present } = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: columnName,
  });
  const typeCheck = await lowerer.lowerToExecuteRequest(
    columnTypeAst({
      schema: schemaName,
      table: tableName,
      column: columnName,
      expectedType: options.formatTypeExpected,
    }),
  );
  return {
    id: `alterType.${tableName}.${columnName}`,
    label: `Alter type of "${tableName}"."${columnName}" to ${options.rawTargetTypeForLabel}`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [step(`ensure column "${columnName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `alter type of "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} TYPE ${options.qualifiedTargetType}${usingClause}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" has type "${options.formatTypeExpected}"`,
        typeCheck.sql,
        typeCheck.params,
      ),
    ],
    meta: { warning: 'TABLE_REWRITE' },
  };
}

export async function setNotNull(
  schemaName: string,
  tableName: string,
  columnName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const { present } = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: columnName,
  });
  const noNulls = await lowerer.lowerToExecuteRequest(
    noNullValuesAst({ schema: schemaName, table: tableName, column: columnName }),
  );
  const notNullable = await lowerer.lowerToExecuteRequest(
    columnNullabilityAst({
      schema: schemaName,
      table: tableName,
      column: columnName,
      nullable: false,
    }),
  );
  return {
    id: `alterNullability.setNotNull.${tableName}.${columnName}`,
    label: `Set NOT NULL on "${tableName}"."${columnName}"`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(`ensure column "${columnName}" exists`, present.sql, present.params),
      step(`ensure no NULL values in "${columnName}"`, noNulls.sql, noNulls.params),
    ],
    execute: [
      step(
        `set NOT NULL on "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} SET NOT NULL`,
      ),
    ],
    postcheck: [
      step(`verify column "${columnName}" is NOT NULL`, notNullable.sql, notNullable.params),
    ],
  };
}

export async function dropNotNull(
  schemaName: string,
  tableName: string,
  columnName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const { present } = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: columnName,
  });
  const nullable = await lowerer.lowerToExecuteRequest(
    columnNullabilityAst({
      schema: schemaName,
      table: tableName,
      column: columnName,
      nullable: true,
    }),
  );
  return {
    id: `alterNullability.dropNotNull.${tableName}.${columnName}`,
    label: `Drop NOT NULL on "${tableName}"."${columnName}"`,
    operationClass: 'widening',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [step(`ensure column "${columnName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `drop NOT NULL on "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} DROP NOT NULL`,
      ),
    ],
    postcheck: [step(`verify column "${columnName}" is nullable`, nullable.sql, nullable.params)],
  };
}

/**
 * `defaultSql` is the full `DEFAULT …` clause as produced by
 * `buildColumnDefaultSql` — e.g. `"DEFAULT 42"`,
 * `"DEFAULT (CURRENT_TIMESTAMP)"`, or `"DEFAULT nextval('seq'::regclass)"`.
 *
 * `operationClass` defaults to `'additive'` (setting a default on a column
 * that currently has none). The reconciliation planner passes `'widening'`
 * when the column already has a different default — policy enforcement
 * treats that as a widening change rather than an additive one.
 */
export async function setDefault(
  schemaName: string,
  tableName: string,
  columnName: string,
  defaultSql: string,
  lowerer: ExecuteRequestLowerer,
  operationClass: 'additive' | 'widening' = 'additive',
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const { present } = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: columnName,
  });
  const hasDefault = await lowerer.lowerToExecuteRequest(
    columnDefaultAst({ schema: schemaName, table: tableName, column: columnName }).defaultPresent(),
  );
  return {
    id: `setDefault.${tableName}.${columnName}`,
    label: `Set default on "${tableName}"."${columnName}"`,
    operationClass,
    // A widening SET DEFAULT changes an existing default, but its postcheck
    // only asserts that *a* default exists — so the idempotency probe would
    // treat "default present" as "already applied" and skip the change.
    ...ifDefined('skipIdempotencyProbe', operationClass === 'widening' ? true : undefined),
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [step(`ensure column "${columnName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `set default on "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} SET ${defaultSql}`,
      ),
    ],
    postcheck: [
      step(`verify column "${columnName}" has a default`, hasDefault.sql, hasDefault.params),
    ],
  };
}

export async function dropDefault(
  schemaName: string,
  tableName: string,
  columnName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { present } = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: columnName,
  });
  const dropDefaultExec = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterTable({
      ...ifDefined('schema', boundSchema(schemaName)),
      table: tableName,
      actions: [contractFreeDdl.dropDefaultAction(columnName)],
    }),
  );
  const noDefault = await lowerer.lowerToExecuteRequest(
    columnDefaultAst({ schema: schemaName, table: tableName, column: columnName }).defaultAbsent(),
  );
  return {
    id: `dropDefault.${tableName}.${columnName}`,
    label: `Drop default on "${tableName}"."${columnName}"`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [step(`ensure column "${columnName}" exists`, present.sql, present.params)],
    execute: [step(`drop default on "${columnName}"`, dropDefaultExec.sql)],
    postcheck: [
      step(`verify column "${columnName}" has no default`, noDefault.sql, noDefault.params),
    ],
  };
}

/**
 * Builds the op for adding a NOT NULL column (no contract default) to a
 * non-empty table. Prechecks assert the column is absent and the table is
 * empty; the execute step lowers the typed `AddColumn` DDL node through the
 * adapter; postchecks assert the column exists and is NOT NULL.
 */
export async function addNotNullColumnDirect(
  schemaName: string,
  tableName: string,
  column: DdlColumn,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const columnName = column.name;
  const addColumn = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterTable({
      ...ifDefined('schema', boundSchema(schemaName)),
      table: tableName,
      actions: [contractFreeDdl.addColumnAction(column)],
    }),
  );
  const absent = await lowerer.lowerToExecuteRequest(
    columnExistsAst({ schema: schemaName, table: tableName, column: columnName }).columnAbsent(),
  );
  const tableEmpty = await lowerer.lowerToExecuteRequest(tableIsEmptyAst(schemaName, tableName));
  const present = await lowerer.lowerToExecuteRequest(
    columnExistsAst({ schema: schemaName, table: tableName, column: columnName }).columnPresent(),
  );
  const notNullable = await lowerer.lowerToExecuteRequest(
    columnNullabilityAst({
      schema: schemaName,
      table: tableName,
      column: columnName,
      nullable: false,
    }),
  );
  return {
    id: `column.${tableName}.${columnName}`,
    label: `Add column ${columnName} to ${tableName}`,
    summary: `Adds column ${columnName} to table ${tableName}`,
    operationClass: 'additive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(`ensure column "${columnName}" is missing`, absent.sql, absent.params),
      step(
        `ensure table "${tableName}" is empty before adding NOT NULL column without default`,
        tableEmpty.sql,
        tableEmpty.params,
      ),
    ],
    execute: [step(`add column "${columnName}"`, addColumn.sql)],
    postcheck: [
      step(`verify column "${columnName}" exists`, present.sql, present.params),
      step(`verify column "${columnName}" is NOT NULL`, notNullable.sql, notNullable.params),
    ],
  };
}
