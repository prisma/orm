import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  BinaryExpr,
  DefaultValueExpr,
  DeleteAst,
  ExistsExpr,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  ParamRef,
  ProjectionItem,
  SelectAst,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { resolvePrimaryKeyColumns } from './collection-contract';
import type { CollectionTables } from './collection-tables';
import { ormError } from './orm-errors';
import { buildOrmQueryPlan, deriveParamsFromAst, resolveTableColumns } from './query-plan-meta';
import { buildPrimaryKeyJoinOn } from './query-plan-source';
import { storageTableForContract } from './storage-resolution';
import { type AliasedTable, createTableScope } from './table-scope';
import { combineWhereExprs } from './where-utils';

function aliasTarget(namespaceId: string, tableName: string): AliasedTable {
  return createTableScope().aliasTable({ namespaceId, tableName });
}

function buildReturningColumns(
  contract: Contract<SqlStorage>,
  target: AliasedTable,
  returningColumns: readonly string[] | undefined,
): ReadonlyArray<ProjectionItem> {
  const { namespaceId, tableName } = target.storage;
  const columns =
    returningColumns && returningColumns.length > 0
      ? [...returningColumns]
      : resolveTableColumns(contract, namespaceId, tableName);

  return columns.map((column) =>
    ProjectionItem.of(
      column,
      target.column(column),
      codecRefForStorageColumn(contract.storage, namespaceId, tableName, column),
    ),
  );
}

function toParamAssignments(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  values: Record<string, unknown>,
): {
  readonly assignments: Record<string, ParamRef>;
} {
  const assignments: Record<string, ParamRef> = {};

  const table = storageTableForContract(contract, namespaceId, tableName);

  for (const [column, value] of Object.entries(values)) {
    if (!table.columns[column]) {
      throw ormError('ORM.COLUMN_UNKNOWN', `Unknown column "${column}" in table "${tableName}"`, {
        meta: { namespaceId, tableName, column },
      });
    }
    const codec = codecRefForStorageColumn(contract.storage, namespaceId, tableName, column);
    assignments[column] = ParamRef.of(value, {
      name: column,
      ...ifDefined('codec', codec),
    });
  }

  return { assignments };
}

function normalizeInsertRows(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): {
  readonly rows: ReadonlyArray<Record<string, ParamRef | DefaultValueExpr>>;
} {
  if (rows.length === 0) {
    throw new InternalError('normalizeInsertRows requires at least one row');
  }

  const orderedColumns: string[] = [];
  const seenColumns = new Set<string>();

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (seenColumns.has(column)) {
        continue;
      }
      seenColumns.add(column);
      orderedColumns.push(column);
    }
  }

  const table = storageTableForContract(contract, namespaceId, tableName);

  const normalizedRows = rows.map((row) => {
    if (orderedColumns.length === 0) {
      return {};
    }

    const normalizedRow: Record<string, ParamRef | DefaultValueExpr> = {};
    for (const column of orderedColumns) {
      if (Object.hasOwn(row, column)) {
        if (!table.columns[column]) {
          throw ormError(
            'ORM.COLUMN_UNKNOWN',
            `Unknown column "${column}" in table "${tableName}"`,
            { meta: { namespaceId, tableName, column } },
          );
        }
        const codec = codecRefForStorageColumn(contract.storage, namespaceId, tableName, column);
        normalizedRow[column] = ParamRef.of(row[column], {
          name: column,
          ...ifDefined('codec', codec),
        });
        continue;
      }
      normalizedRow[column] = new DefaultValueExpr();
    }
    return normalizedRow;
  });

  return { rows: normalizedRows };
}

/**
 * Ask the database to skip rows that collide with a unique constraint.
 * An empty `columns` list means every unique constraint on the table.
 */
export interface InsertConflictSkip {
  readonly columns: readonly string[];
}

function conflictSkipClause(
  target: AliasedTable,
  conflictSkip: InsertConflictSkip | undefined,
): InsertOnConflict | undefined {
  if (!conflictSkip) return undefined;
  if (conflictSkip.columns.length === 0) return InsertOnConflict.doNothing();
  return InsertOnConflict.on(
    conflictSkip.columns.map((column) => target.column(column)),
  ).doNothing();
}

export function compileInsertReturning(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
  conflictSkip?: InsertConflictSkip,
): SqlQueryPlan<Record<string, unknown>> {
  const target = aliasTarget(namespaceId, tableName);
  const { rows: normalizedRows } = normalizeInsertRows(contract, namespaceId, tableName, rows);
  const ast = InsertAst.into(target.tableSource(contract))
    .withRows(normalizedRows)
    .withOnConflict(conflictSkipClause(target, conflictSkip))
    .withReturning(buildReturningColumns(contract, target, returningColumns));
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileInsertCount(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  conflictSkip?: InsertConflictSkip,
): SqlQueryPlan<Record<string, unknown>> {
  const target = aliasTarget(namespaceId, tableName);
  const { rows: normalizedRows } = normalizeInsertRows(contract, namespaceId, tableName, rows);
  const ast = InsertAst.into(target.tableSource(contract))
    .withRows(normalizedRows)
    .withOnConflict(conflictSkipClause(target, conflictSkip));
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

function stripUndefinedValues(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function buildCountMutationWhere(
  contract: Contract<SqlStorage>,
  tables: CollectionTables,
  filters: readonly AnyExpression[],
  variantName: string | undefined,
): AnyExpression | undefined {
  const variantTable = variantName === undefined ? undefined : tables.variants.get(variantName);
  if (variantTable === undefined) {
    return combineWhereExprs(filters);
  }

  const { root } = tables;
  const pkColumns = resolvePrimaryKeyColumns(
    contract,
    root.storage.namespaceId,
    root.storage.tableName,
  );
  const rootCopy = tables.scope.copy().aliasTable(root.storage);
  const correlation = pkColumns.map((column) =>
    BinaryExpr.eq(rootCopy.column(column), root.column(column)),
  );
  const where = combineWhereExprs([...correlation, ...filters]);
  let subquery = SelectAst.from(rootCopy.tableSource(contract))
    .withProjection(pkColumns.map((column) => ProjectionItem.of(column, rootCopy.column(column))))
    .withJoins([
      JoinAst.inner(
        variantTable.tableSource(contract),
        buildPrimaryKeyJoinOn(rootCopy, variantTable, pkColumns),
      ),
    ]);

  if (where) {
    subquery = subquery.withWhere(where);
  }

  return ExistsExpr.exists(subquery);
}

// Groups rows by their set of present columns so each group can be emitted as a single INSERT statement. Groups are created in input order — rows with the same signature that are non-adjacent produce separate groups. This is deliberate: preserving insertion order ensures autogenerated/autoincrement columns are assigned in the same order as the caller's input.
function groupRowsByColumnSignature(
  rows: readonly Record<string, unknown>[],
): ReadonlyArray<readonly Record<string, unknown>[]> {
  const groups: Array<Record<string, unknown>[]> = [];
  let currentKey = '';
  let currentGroup: Record<string, unknown>[] = [];

  for (const rawRow of rows) {
    const row = stripUndefinedValues(rawRow);
    const key = Object.keys(row).sort().join(',');
    if (key !== currentKey || currentGroup.length === 0) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentKey = key;
      currentGroup = [row];
    } else {
      currentGroup.push(row);
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

export function compileInsertReturningSplit(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
  conflictSkip?: InsertConflictSkip,
): ReadonlyArray<SqlQueryPlan<Record<string, unknown>>> {
  if (rows.length === 0) {
    throw ormError('ORM.MUTATION_DATA_MISSING', 'create() requires at least one row', {
      meta: { method: 'create', namespaceId, tableName },
    });
  }
  return groupRowsByColumnSignature(rows).map((group) =>
    compileInsertReturning(contract, namespaceId, tableName, group, returningColumns, conflictSkip),
  );
}

export function compileInsertCountSplit(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  conflictSkip?: InsertConflictSkip,
): ReadonlyArray<SqlQueryPlan<Record<string, unknown>>> {
  if (rows.length === 0) {
    throw ormError('ORM.MUTATION_DATA_MISSING', 'createAndCount() requires at least one row', {
      meta: { method: 'createAndCount', namespaceId, tableName },
    });
  }
  return groupRowsByColumnSignature(rows).map((group) =>
    compileInsertCount(contract, namespaceId, tableName, group, conflictSkip),
  );
}

export function compileUpsertReturning(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  createValues: Record<string, unknown>,
  updateValues: Record<string, unknown>,
  conflictColumns: readonly string[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const createAssignments = toParamAssignments(contract, namespaceId, tableName, createValues);
  const hasUpdateValues = Object.keys(updateValues).length > 0;
  const updateAssignments = hasUpdateValues
    ? toParamAssignments(contract, namespaceId, tableName, updateValues)
    : undefined;
  const target = aliasTarget(namespaceId, tableName);
  const conflictTarget = InsertOnConflict.on(
    conflictColumns.map((column) => target.column(column)),
  );
  const onConflict = updateAssignments
    ? conflictTarget.doUpdateSet(updateAssignments.assignments)
    : conflictTarget.doNothing();

  const ast = InsertAst.into(target.tableSource(contract))
    .withRows([createAssignments.assignments])
    .withOnConflict(onConflict)
    .withReturning(buildReturningColumns(contract, target, returningColumns));

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileUpdateReturning(
  contract: Contract<SqlStorage>,
  tables: CollectionTables,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const { root } = tables;
  const { namespaceId, tableName } = root.storage;
  const where = combineWhereExprs(filters);
  const { assignments } = toParamAssignments(contract, namespaceId, tableName, setValues);
  let ast = UpdateAst.table(root.tableSource(contract))
    .withSet(assignments)
    .withReturning(buildReturningColumns(contract, root, returningColumns));
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileUpdateCount(
  contract: Contract<SqlStorage>,
  tables: CollectionTables,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
  variantName?: string | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const { root } = tables;
  const { namespaceId, tableName } = root.storage;
  const where = buildCountMutationWhere(contract, tables, filters, variantName);
  const { assignments } = toParamAssignments(contract, namespaceId, tableName, setValues);
  let ast = UpdateAst.table(root.tableSource(contract)).withSet(assignments);
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileDeleteReturning(
  contract: Contract<SqlStorage>,
  tables: CollectionTables,
  filters: readonly AnyExpression[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const { root } = tables;
  const where = combineWhereExprs(filters);
  let ast = DeleteAst.from(root.tableSource(contract)).withReturning(
    buildReturningColumns(contract, root, returningColumns),
  );
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileDeleteCount(
  contract: Contract<SqlStorage>,
  tables: CollectionTables,
  filters: readonly AnyExpression[],
  variantName?: string | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = buildCountMutationWhere(contract, tables, filters, variantName);
  let ast = DeleteAst.from(tables.root.tableSource(contract));
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}
