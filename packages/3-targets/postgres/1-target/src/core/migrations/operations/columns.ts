import { convertedColumnMeta, requiredColumnMeta } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { expectAbsent, expectPresent } from '@internal/framework-components/control';
import type { DdlColumn } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import {
  columnDefaultAst,
  columnDefaultSequenceAst,
  columnExistsAst,
  columnNullabilityAst,
  columnOwnsSequenceAst,
  columnTypeAst,
  columnTypeOidAst,
  noNullValuesAst,
  sequenceNameAvailableAst,
  sequenceValuesFitAst,
  tableIsEmptyAst,
} from '../../../contract-free/checks';
import * as contractFreeDdl from '../../../contract-free/ddl';
import { postgresError } from '../../errors';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { type AutoincrementWidth, autoincrementWidth } from '../autoincrement-widths';
import { boundSchema } from '../bound-schema';
import { defaultSequenceName } from '../default-sequence-name';
import { type ColumnTypeCheck, columnTypeCheckText, qualifyTableName } from '../planner-sql-checks';
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

/** The check that the column has the type `check` recognises: by the text `format_type` prints, or by the type's identity. */
function columnTypeCheckAst(location: ColumnLocation, check: ColumnTypeCheck) {
  return check.kind === 'catalog-text'
    ? columnTypeAst({ ...location, expectedType: check.text })
    : columnTypeOidAst({ ...location, type: check.typeName, many: check.many });
}

/**
 * The postcheck step that the column has the type `type`: as `check` recognises it when the stack's data types read the type, and otherwise by the type's oid, which ignores a type modifier.
 */
export async function columnTypeStep(
  lowerer: ExecuteRequestLowerer,
  location: ColumnLocation,
  type: string,
  check: ColumnTypeCheck | undefined,
) {
  const lowered = await lowerer.lowerToExecuteRequest(
    check === undefined
      ? columnTypeOidAst({ ...location, type, many: false })
      : columnTypeCheckAst(location, check),
  );
  return step(
    `verify column "${location.column}" has type ${check === undefined ? `"${type}"` : columnTypeCheckText(check)}`,
    lowered.sql,
    lowered.params,
  );
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
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
    ],
    execute: [
      step(
        `drop column "${columnName}"`,
        `ALTER TABLE ${qualified} DROP COLUMN ${quoteIdentifier(columnName)}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" does not exist`,
        absent.sql,
        absent.params,
        expectAbsent(`column "${columnName}" on "${tableName}"`),
      ),
    ],
  };
}

export function renameColumnStatement(
  schemaName: string,
  tableName: string,
  fromName: string,
  toName: string,
): string {
  return `ALTER TABLE ${qualifyTableName(schemaName, tableName)} RENAME COLUMN ${quoteIdentifier(fromName)} TO ${quoteIdentifier(toName)}`;
}

export function renameColumnOperationId(tableName: string, fromName: string): string {
  return `renameColumn.${tableName}.${fromName}`;
}

export async function renameColumn(
  schemaName: string,
  tableName: string,
  fromName: string,
  toName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const from = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: fromName,
  });
  const to = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: toName,
  });
  return {
    id: renameColumnOperationId(tableName, fromName),
    label: `Rename column "${tableName}"."${fromName}" to "${toName}"`,
    operationClass: 'widening',
    target: targetDetails('column', toName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${fromName}" exists`,
        from.present.sql,
        from.present.params,
        expectPresent(`column "${fromName}" on "${tableName}"`),
      ),
      step(
        `ensure column "${toName}" does not exist`,
        to.absent.sql,
        to.absent.params,
        expectAbsent(`column "${toName}" on "${tableName}"`),
      ),
    ],
    execute: [
      step(
        `rename column "${fromName}" to "${toName}"`,
        renameColumnStatement(schemaName, tableName, fromName, toName),
      ),
    ],
    postcheck: [
      step(
        `verify column "${toName}" exists`,
        to.present.sql,
        to.present.params,
        expectPresent(`column "${toName}" on "${tableName}"`),
      ),
      step(
        `verify column "${fromName}" no longer exists`,
        from.absent.sql,
        from.absent.params,
        expectAbsent(`column "${fromName}" on "${tableName}"`),
      ),
    ],
  };
}

/**
 * A type change is `widening` when every value of the old type converts to the new type unchanged,
 * and `data` when the user writes the conversion in its USING clause.
 */
export type AlterColumnTypeClass = 'widening' | 'destructive' | 'data';

/**
 * `type` is the new column type as a migration writes it, into the `ALTER COLUMN TYPE` clause.
 * `checkType` is how the postcheck recognises the new type. `sequence` is
 * the width of the sequence the column owns when it has an `autoincrement()` default: the operation
 * finds that sequence in the catalog and changes it to the new width, refusing first when the
 * sequence has handed out a value past that width. A column whose default reads a sequence it does
 * not own changes type and leaves the sequence alone. The postcheck asks for the type, and for the
 * sequence width when the column owns one.
 */
export async function alterColumnType(
  schemaName: string,
  tableName: string,
  columnName: string,
  options: {
    readonly type: string;
    readonly checkType: ColumnTypeCheck;
    readonly using?: string;
    readonly sequenceWidth: AutoincrementWidth | undefined;
  },
  lowerer: ExecuteRequestLowerer,
  operationClass: AlterColumnTypeClass = 'destructive',
): Promise<Op> {
  const { present } = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: columnName,
  });
  const typeCheck = await lowerer.lowerToExecuteRequest(
    columnTypeCheckAst(
      { schema: schemaName, table: tableName, column: columnName },
      options.checkType,
    ),
  );
  const alterType = await lowerer.lowerToExecuteRequest(
    contractFreeDdl.alterTable({
      ...ifDefined('schema', boundSchema(schemaName)),
      table: tableName,
      actions: [
        contractFreeDdl.alterColumnTypeAction({
          columnName,
          type: options.type,
          ...ifDefined('using', options.using),
        }),
      ],
    }),
  );
  const sequenceSteps = await ownedSequenceSteps(
    lowerer,
    { schema: schemaName, table: tableName, column: columnName },
    options.sequenceWidth,
  );
  return {
    id: `alterType.${tableName}.${columnName}`,
    label: `Alter type of "${tableName}"."${columnName}" to ${options.type}`,
    operationClass,
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
      ...sequenceSteps.precheck,
    ],
    execute: [
      {
        ...step(`alter type of "${columnName}" to ${options.type}`, alterType.sql),
        ...(options.using !== undefined
          ? { meta: convertedColumnMeta(tableName, columnName, 'conversion') }
          : operationClass === 'destructive'
            ? { meta: convertedColumnMeta(tableName, columnName, 'cast') }
            : {}),
      },
      ...sequenceSteps.execute,
    ],
    postcheck: [
      step(
        `verify column "${columnName}" has type ${columnTypeCheckText(options.checkType)}`,
        typeCheck.sql,
        typeCheck.params,
      ),
      ...sequenceSteps.postcheck,
    ],
    meta: { warning: 'TABLE_REWRITE' },
  };
}

async function ownedSequenceSteps(
  lowerer: ExecuteRequestLowerer,
  location: ColumnLocation,
  width: AutoincrementWidth | undefined,
) {
  if (width === undefined) return { precheck: [], execute: [], postcheck: [] };
  const { sequenceType, maxValue } = width;
  const fits = await lowerer.lowerToExecuteRequest(sequenceValuesFitAst({ ...location, maxValue }));
  const owns = await lowerer.lowerToExecuteRequest(
    columnOwnsSequenceAst({ ...location, sequenceType, orNone: true }),
  );
  return {
    precheck: [
      step(
        `ensure the sequence column "${location.column}" owns has no value past the ${sequenceType} range`,
        fits.sql,
        fits.params,
      ),
    ],
    execute: [
      step(
        `change the sequence column "${location.column}" owns, if any, to ${sequenceType}`,
        doBlock(
          `IF ${ownedSequenceSql(location)} IS NOT NULL THEN ${alterOwnedSequenceTypeStatement(location, sequenceType)} END IF;`,
        ),
      ),
    ],
    postcheck: [
      step(
        `verify the sequence column "${location.column}" owns, if any, is of type ${sequenceType}`,
        owns.sql,
        owns.params,
      ),
    ],
  };
}

interface ColumnLocation {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}

/** SQL for the sequence the column owns, as a `regclass`, found at run time. */
function ownedSequenceSql(location: ColumnLocation): string {
  return `pg_get_serial_sequence('${escapeLiteral(qualifyTableName(location.schema, location.table))}', '${escapeLiteral(location.column)}')::regclass`;
}

/** A `DO` block around `body`, quoted with a dollar tag that `body` does not contain. */
function doBlock(body: string): string {
  let tag = '$prisma$';
  for (let n = 1; body.includes(tag); n += 1) tag = `$prisma${n}$`;
  return `DO ${tag} BEGIN ${body} END ${tag}`;
}

/** PL/pgSQL that runs `ALTER SEQUENCE … AS <type>` on the sequence the column owns, whatever its name. */
function alterOwnedSequenceTypeStatement(location: ColumnLocation, sequenceType: string): string {
  return `EXECUTE format('ALTER SEQUENCE %s AS ${sequenceType}', ${ownedSequenceSql(location)});`;
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
    operationClass: 'widening',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
      {
        ...step(`ensure no NULL values in "${columnName}"`, noNulls.sql, noNulls.params),
        meta: requiredColumnMeta(tableName, columnName, 'nullValues'),
      },
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
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
    ],
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
 * Sets `column`'s default. The adapter writes the `DEFAULT …` clause, reading a literal default with
 * the column's codec first, as every DDL statement that writes a default does. An `autoincrement()`
 * default attaches a sequence instead ({@link setAutoincrementDefault}).
 *
 * `operationClass` is `'additive'` when the column has no default yet and `'widening'` when it replaces one; policy enforcement reads it.
 *
 * The operation carries no postcheck. The runner skips an operation whose postchecks already hold before it runs. A check that the column has a default also holds for the old default, so the runner would skip a changed default. A check that compares the value would need the text Postgres stores for the default, predicted at plan time, which is fragile. Instead the run's final schema verification compares the default's value. Running `SET DEFAULT` again on a column that already has that default is harmless.
 */
export async function setDefault(
  schemaName: string,
  tableName: string,
  column: DdlColumn,
  lowerer: ExecuteRequestLowerer,
  operationClass: 'additive' | 'widening',
): Promise<Op> {
  if (column.default === undefined) {
    throw postgresError(
      'CONTRACT.DEFAULT_INVALID',
      `setDefault on column "${column.name}" of table "${tableName}" has no default. Pass the column with its default, as in col(name, type, { default: lit(value) }) or col(name, type, { default: fn(expression) }).`,
      {
        meta: { table: tableName, column: column.name, reason: 'set-default-without-default' },
      },
    );
  }
  if (column.default.kind === 'function' && column.default.expression.text === 'autoincrement()') {
    return setAutoincrementDefault(schemaName, tableName, column, lowerer, operationClass);
  }
  const columnName = column.name;
  const qualified = qualifyTableName(schemaName, tableName);
  const clause = await lowerer.renderColumnDefault(column, tableName);
  const { present } = await columnExistsSteps(lowerer, {
    schema: schemaName,
    table: tableName,
    column: columnName,
  });
  return {
    id: `setDefault.${tableName}.${columnName}`,
    label: `Set default on "${tableName}"."${columnName}"`,
    operationClass,
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
    ],
    execute: [
      step(
        `set default on "${columnName}"`,
        `ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} SET ${clause}`,
      ),
    ],
    postcheck: [],
  };
}

/**
 * Gives an existing smallint, integer or bigint column an `autoincrement()` default. When the column
 * already owns a sequence, whatever its name (dropping the default leaves it in place, and a rename
 * of the table or column does not rename it), the operation reuses it; otherwise it creates the
 * sequence a SERIAL column of that width would get and makes the column own it. It then sets the
 * sequence to the column's width, sets the column's default to it, and starts it past the column's
 * largest value so existing rows never collide. The precheck refuses, when the column owns no
 * sequence, a name another relation holds. The postcheck asks for the attached sequence and the
 * `nextval(` default, which no earlier default satisfies, and that the sequence has the column's
 * width, which a narrower sequence left from before the column was widened does not satisfy.
 */
async function setAutoincrementDefault(
  schemaName: string,
  tableName: string,
  column: DdlColumn,
  lowerer: ExecuteRequestLowerer,
  operationClass: 'additive' | 'widening',
): Promise<Op> {
  const columnName = column.name;
  const sequenceType = autoincrementWidth(column.type)?.sequenceType;
  if (sequenceType === undefined) {
    throw postgresError(
      'CONTRACT.DEFAULT_INVALID',
      `setDefault can give the column "${columnName}" of table "${tableName}" an autoincrement() default only when its type is smallint, integer or bigint (int2, int4 or int8); its type is "${column.type}".`,
      { meta: { table: tableName, column: columnName, reason: 'set-default-autoincrement' } },
    );
  }
  const qualifiedTable = qualifyTableName(schemaName, tableName);
  const qualifiedColumn = quoteIdentifier(columnName);
  const location = { schema: schemaName, table: tableName, column: columnName };
  const ownedSequence = ownedSequenceSql(location);
  const sequenceName = defaultSequenceName(tableName, columnName);
  const qualifiedSequence = qualifyTableName(schemaName, sequenceName);
  const { present } = await columnExistsSteps(lowerer, location);
  const nameAvailable = await lowerer.lowerToExecuteRequest(
    sequenceNameAvailableAst({ ...location, sequence: sequenceName }),
  );
  const attached = await lowerer.lowerToExecuteRequest(columnDefaultSequenceAst(location));
  const ownsSequence = await lowerer.lowerToExecuteRequest(
    columnOwnsSequenceAst({ ...location, sequenceType, orNone: false }),
  );
  return {
    id: `setDefault.${tableName}.${columnName}`,
    label: `Set default on "${tableName}"."${columnName}"`,
    operationClass,
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
      step(
        `ensure column "${columnName}" owns a sequence or no relation is named ${qualifiedSequence} (rename that relation, or write this migration with migration new)`,
        nameAvailable.sql,
        nameAvailable.params,
      ),
    ],
    execute: [
      step(
        `create sequence "${sequenceName}" owned by "${columnName}" unless the column owns one`,
        doBlock(
          `IF ${ownedSequence} IS NULL THEN CREATE SEQUENCE ${qualifiedSequence} AS ${sequenceType}; ALTER SEQUENCE ${qualifiedSequence} OWNED BY ${qualifiedTable}.${qualifiedColumn}; END IF;`,
        ),
      ),
      step(
        `change the sequence column "${columnName}" owns to ${sequenceType}`,
        doBlock(alterOwnedSequenceTypeStatement(location, sequenceType)),
      ),
      step(
        `set default on "${columnName}" to the sequence it owns`,
        doBlock(
          `EXECUTE format('ALTER TABLE %s ALTER COLUMN %I SET DEFAULT nextval(%L::regclass)', '${escapeLiteral(qualifiedTable)}', '${escapeLiteral(columnName)}', ${ownedSequence}::text);`,
        ),
      ),
      step(
        `start the sequence column "${columnName}" owns past the largest "${columnName}"`,
        `SELECT setval(${ownedSequence}, GREATEST(COALESCE(MAX(${qualifiedColumn}), 0), 0) + 1, false) FROM ${qualifiedTable}`,
      ),
    ],
    postcheck: [
      step(
        `verify column "${columnName}" takes its default from an attached sequence`,
        attached.sql,
        attached.params,
      ),
      step(
        `verify column "${columnName}" owns a sequence of type ${sequenceType}`,
        ownsSequence.sql,
        ownsSequence.params,
      ),
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
    operationClass: 'widening',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
    ],
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
export async function addRequiredColumnToEmptyTable(
  schemaName: string,
  tableName: string,
  column: DdlColumn,
  checkType: ColumnTypeCheck | undefined,
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
  const hasType = await columnTypeStep(
    lowerer,
    { schema: schemaName, table: tableName, column: columnName },
    column.type,
    checkType,
  );
  return {
    id: `column.${tableName}.${columnName}`,
    label: `Add column ${columnName} to ${tableName}`,
    summary: `Adds column ${columnName} to table ${tableName}`,
    operationClass: 'additive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure column "${columnName}" is missing`,
        absent.sql,
        absent.params,
        expectAbsent(`column "${columnName}" on "${tableName}"`),
      ),
      {
        ...step(
          `ensure table "${tableName}" is empty before adding NOT NULL column without default`,
          tableEmpty.sql,
          tableEmpty.params,
        ),
        meta: requiredColumnMeta(tableName, columnName, 'newField'),
      },
    ],
    execute: [step(`add column "${columnName}"`, addColumn.sql)],
    postcheck: [
      step(
        `verify column "${columnName}" exists`,
        present.sql,
        present.params,
        expectPresent(`column "${columnName}" on "${tableName}"`),
      ),
      step(`verify column "${columnName}" is NOT NULL`, notNullable.sql, notNullable.params),
      hasType,
    ],
  };
}
