import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { REFERENTIAL_ACTION_SQL } from '@internal/sql-contract/referential-action-sql';
import { InternalError } from '@internal/utils/internal-error';
import { constraintExistsAst } from '../../../contract-free/checks';
import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import { type ForeignKeySpec, type Op, step, targetDetails } from './shared';

async function constraintCheckSteps(
  lowerer: ExecuteRequestLowerer,
  options: { constraintName: string; schema: string; table: string },
): Promise<{
  absent: { sql: string; params?: readonly unknown[] };
  present: { sql: string; params?: readonly unknown[] };
}> {
  const checks = constraintExistsAst(options);
  const absent = await lowerer.lowerToExecuteRequest(checks.constraintAbsent());
  const present = await lowerer.lowerToExecuteRequest(checks.constraintPresent());
  return { absent, present };
}

function renderForeignKeySql(schemaName: string, tableName: string, fk: ForeignKeySpec): string {
  let sql = `ALTER TABLE ${qualifyTableName(schemaName, tableName)}
ADD CONSTRAINT ${quoteIdentifier(fk.name)}
FOREIGN KEY (${fk.columns.map(quoteIdentifier).join(', ')})
REFERENCES ${qualifyTableName(fk.references.schema, fk.references.table)} (${fk.references.columns
    .map(quoteIdentifier)
    .join(', ')})`;

  if (fk.onDelete !== undefined) {
    const action = REFERENTIAL_ACTION_SQL[fk.onDelete];
    if (!action) {
      throw new InternalError(`Unknown referential action for onDelete: ${String(fk.onDelete)}`);
    }
    sql += `\nON DELETE ${action}`;
  }
  if (fk.onUpdate !== undefined) {
    const action = REFERENTIAL_ACTION_SQL[fk.onUpdate];
    if (!action) {
      throw new InternalError(`Unknown referential action for onUpdate: ${String(fk.onUpdate)}`);
    }
    sql += `\nON UPDATE ${action}`;
  }
  return sql;
}

export async function addPrimaryKey(
  schemaName: string,
  tableName: string,
  constraintName: string,
  columns: readonly string[],
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnList = columns.map(quoteIdentifier).join(', ');
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `primaryKey.${tableName}.${constraintName}`,
    label: `Add primary key on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('primaryKey', constraintName, schemaName, tableName),
    precheck: [
      step(`ensure primary key "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
    execute: [
      step(
        `add primary key "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} PRIMARY KEY (${columnList})`,
      ),
    ],
    postcheck: [step(`verify primary key "${constraintName}" exists`, present.sql, present.params)],
  };
}

export async function addUnique(
  schemaName: string,
  tableName: string,
  constraintName: string,
  columns: readonly string[],
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const columnList = columns.map(quoteIdentifier).join(', ');
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `unique.${tableName}.${constraintName}`,
    label: `Add unique constraint on "${tableName}" (${columns.join(', ')})`,
    operationClass: 'additive',
    target: targetDetails('unique', constraintName, schemaName, tableName),
    precheck: [
      step(`ensure constraint "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
    execute: [
      step(
        `add unique constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} UNIQUE (${columnList})`,
      ),
    ],
    postcheck: [step(`verify constraint "${constraintName}" exists`, present.sql, present.params)],
  };
}

export async function addForeignKey(
  schemaName: string,
  tableName: string,
  fk: ForeignKeySpec,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName: fk.name,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `foreignKey.${tableName}.${fk.name}`,
    label: `Add foreign key "${fk.name}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('foreignKey', fk.name, schemaName, tableName),
    precheck: [step(`ensure FK "${fk.name}" does not exist`, absent.sql, absent.params)],
    execute: [step(`add FK "${fk.name}"`, renderForeignKeySql(schemaName, tableName, fk))],
    postcheck: [step(`verify FK "${fk.name}" exists`, present.sql, present.params)],
  };
}

export async function addCheckConstraint(
  schemaName: string,
  tableName: string,
  constraintName: string,
  expression: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `checkConstraint.${tableName}.${constraintName}`,
    label: `Add check constraint "${constraintName}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('checkConstraint', constraintName, schemaName, tableName),
    precheck: [
      step(`ensure constraint "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
    execute: [
      step(
        `add check constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} CHECK (${expression})`,
      ),
    ],
    postcheck: [step(`verify constraint "${constraintName}" exists`, present.sql, present.params)],
  };
}

export type RenamableConstraintKind = 'primaryKey' | 'unique' | 'foreignKey' | 'checkConstraint';

const CONSTRAINT_KIND_LABEL: Readonly<Record<RenamableConstraintKind, string>> = {
  primaryKey: 'primary key',
  unique: 'unique constraint',
  foreignKey: 'foreign key',
  checkConstraint: 'check constraint',
};

export function renameConstraintLabel(
  kind: RenamableConstraintKind,
  fromName: string,
  toName: string,
  tableName: string,
): string {
  return `Rename ${CONSTRAINT_KIND_LABEL[kind]} "${fromName}" to "${toName}" on "${tableName}"`;
}

export async function renameConstraint(
  schemaName: string,
  tableName: string,
  kind: RenamableConstraintKind,
  fromName: string,
  toName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  // `constraintCheckSteps` is kind-agnostic, so the same helper answers for
  // both names.
  const from = await constraintCheckSteps(lowerer, {
    constraintName: fromName,
    schema: schemaName,
    table: tableName,
  });
  const to = await constraintCheckSteps(lowerer, {
    constraintName: toName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `${kind}.${schemaName}.${tableName}.${fromName}.rename`,
    label: renameConstraintLabel(kind, fromName, toName, tableName),
    operationClass: 'widening',
    // The NEW name is the constraint's contract-side identity — the rename
    // convention indexes and policies already follow.
    target: targetDetails(kind, toName, schemaName, tableName),
    precheck: [
      step(`ensure constraint "${fromName}" exists`, from.present.sql, from.present.params),
      step(`ensure constraint "${toName}" does not exist`, to.absent.sql, to.absent.params),
    ],
    execute: [
      step(
        `rename ${CONSTRAINT_KIND_LABEL[kind]} "${fromName}" to "${toName}"`,
        `ALTER TABLE ${qualified} RENAME CONSTRAINT ${quoteIdentifier(fromName)} TO ${quoteIdentifier(toName)}`,
      ),
    ],
    postcheck: [step(`verify constraint "${toName}" exists`, to.present.sql, to.present.params)],
  };
}

export async function dropCheckConstraint(
  schemaName: string,
  tableName: string,
  constraintName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `dropCheckConstraint.${tableName}.${constraintName}`,
    label: `Drop check constraint "${constraintName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('checkConstraint', constraintName, schemaName, tableName),
    precheck: [step(`ensure constraint "${constraintName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `drop check constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} DROP CONSTRAINT ${quoteIdentifier(constraintName)}`,
      ),
    ],
    postcheck: [
      step(`verify constraint "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
  };
}

/**
 * `kind` feeds the operation's `target.details.objectType`. Descriptor-flow
 * does not carry kind information in its drop-constraint descriptor, so the
 * default is `'unique'`. The reconciliation planner passes the correct kind
 * (`'foreignKey'`, `'primaryKey'`, or `'unique'`) based on the diff issue
 * that produced the drop.
 */
export async function dropConstraint(
  schemaName: string,
  tableName: string,
  constraintName: string,
  lowerer: ExecuteRequestLowerer,
  kind: 'foreignKey' | 'unique' | 'primaryKey' = 'unique',
): Promise<Op> {
  const qualified = qualifyTableName(schemaName, tableName);
  const { absent, present } = await constraintCheckSteps(lowerer, {
    constraintName,
    schema: schemaName,
    table: tableName,
  });
  return {
    id: `dropConstraint.${tableName}.${constraintName}`,
    label: `Drop constraint "${constraintName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails(kind, constraintName, schemaName, tableName),
    precheck: [step(`ensure constraint "${constraintName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `drop constraint "${constraintName}"`,
        `ALTER TABLE ${qualified} DROP CONSTRAINT ${quoteIdentifier(constraintName)}`,
      ),
    ],
    postcheck: [
      step(`verify constraint "${constraintName}" does not exist`, absent.sql, absent.params),
    ],
  };
}
