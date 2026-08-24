import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  type AstRewriter,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  EqColJoinOn,
  ExistsExpr,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { resolvePolymorphismInfo, resolvePrimaryKeyColumn } from './collection-contract';
import { ormError } from './orm-errors';
import { buildOrmQueryPlan, deriveParamsFromAst, resolveTableColumns } from './query-plan-meta';
import { storageTableForContract, tableSourceForContract } from './storage-resolution';
import { combineWhereExprs } from './where-utils';

function buildReturningColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  returningColumns: readonly string[] | undefined,
): ReadonlyArray<ProjectionItem> {
  const columns =
    returningColumns && returningColumns.length > 0
      ? [...returningColumns]
      : resolveTableColumns(contract, namespaceId, tableName);

  return columns.map((column) =>
    ProjectionItem.of(
      column,
      ColumnRef.of(tableName, column),
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

export function compileInsertReturning(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const { rows: normalizedRows } = normalizeInsertRows(contract, namespaceId, tableName, rows);
  const ast = InsertAst.into(tableSourceForContract(contract, namespaceId, tableName))
    .withRows(normalizedRows)
    .withReturning(buildReturningColumns(contract, namespaceId, tableName, returningColumns));
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileInsertCount(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): SqlQueryPlan<Record<string, unknown>> {
  const { rows: normalizedRows } = normalizeInsertRows(contract, namespaceId, tableName, rows);
  const ast = InsertAst.into(tableSourceForContract(contract, namespaceId, tableName)).withRows(
    normalizedRows,
  );
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

function createTableRefRemapper(fromTable: string, toTable: string): AstRewriter {
  return {
    columnRef: (col) => (col.table === fromTable ? ColumnRef.of(toTable, col.column) : col),
    tableSource: (source) => {
      if (source.alias === fromTable) {
        return TableSource.named(source.name, toTable, source.namespaceId);
      }
      if (!source.alias && source.name === fromTable) {
        return TableSource.named(source.name, toTable, source.namespaceId);
      }
      return source;
    },
    eqColJoinOn: (on) =>
      EqColJoinOn.of(
        on.left.table === fromTable ? ColumnRef.of(toTable, on.left.column) : on.left,
        on.right.table === fromTable ? ColumnRef.of(toTable, on.right.column) : on.right,
      ),
  };
}

function buildCountMutationWhere(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  filters: readonly AnyExpression[],
  variantName?: string | undefined,
  modelName?: string | undefined,
): AnyExpression | undefined {
  if (!variantName || !modelName) {
    return combineWhereExprs(filters);
  }

  const polyInfo = resolvePolymorphismInfo(contract, namespaceId, modelName);
  const variant = polyInfo?.variants.get(variantName);
  if (!polyInfo || !variant || variant.strategy !== 'mti') {
    return combineWhereExprs(filters);
  }

  const pkColumn = resolvePrimaryKeyColumn(contract, namespaceId, tableName);
  const baseTableRef = `${tableName}__write_filter`;
  const remapper = createTableRefRemapper(tableName, baseTableRef);
  const innerFilters = filters.map((filter) => filter.rewrite(remapper));
  const correlation = BinaryExpr.eq(
    ColumnRef.of(baseTableRef, pkColumn),
    ColumnRef.of(tableName, pkColumn),
  );
  const where = combineWhereExprs([correlation, ...innerFilters]);
  const joinOn = EqColJoinOn.of(
    ColumnRef.of(baseTableRef, pkColumn),
    ColumnRef.of(variant.table, pkColumn),
  );
  let subquery = SelectAst.from(TableSource.named(tableName, baseTableRef, namespaceId))
    .withProjection([ProjectionItem.of('_write_filter', ColumnRef.of(baseTableRef, pkColumn))])
    .withJoins([
      JoinAst.inner(tableSourceForContract(contract, namespaceId, variant.table), joinOn),
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
): ReadonlyArray<SqlQueryPlan<Record<string, unknown>>> {
  if (rows.length === 0) {
    throw ormError('ORM.MUTATION_DATA_MISSING', 'create() requires at least one row', {
      meta: { method: 'create', namespaceId, tableName },
    });
  }
  return groupRowsByColumnSignature(rows).map((group) =>
    compileInsertReturning(contract, namespaceId, tableName, group, returningColumns),
  );
}

export function compileInsertCountSplit(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
): ReadonlyArray<SqlQueryPlan<Record<string, unknown>>> {
  if (rows.length === 0) {
    throw ormError('ORM.MUTATION_DATA_MISSING', 'createAndCount() requires at least one row', {
      meta: { method: 'createAndCount', namespaceId, tableName },
    });
  }
  return groupRowsByColumnSignature(rows).map((group) =>
    compileInsertCount(contract, namespaceId, tableName, group),
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
  const onConflict = updateAssignments
    ? InsertOnConflict.on(
        conflictColumns.map((column) => ColumnRef.of(tableName, column)),
      ).doUpdateSet(updateAssignments.assignments)
    : InsertOnConflict.on(
        conflictColumns.map((column) => ColumnRef.of(tableName, column)),
      ).doNothing();

  const ast = InsertAst.into(tableSourceForContract(contract, namespaceId, tableName))
    .withRows([createAssignments.assignments])
    .withOnConflict(onConflict)
    .withReturning(buildReturningColumns(contract, namespaceId, tableName, returningColumns));

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

/**
 * How a batched upsert resolves a conflict. `updateColumns` are assigned from
 * the proposed row (`excluded.<column>`) so each conflicting row is updated
 * with its own values — the whole point of a batched upsert, which a literal
 * SET clause shared by every row cannot express. `updateDefaults` are the
 * onUpdate mutation defaults (e.g. `@updatedAt`) for columns the update set
 * does not already carry; they bind as literal params and win over an
 * `excluded` assignment for the same column.
 */
export interface UpsertConflictResolution {
  readonly columns: readonly string[];
  readonly updateColumns: readonly string[];
  readonly updateDefaults: Record<string, unknown>;
}

function buildBatchedOnConflict(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  conflict: UpsertConflictResolution,
): InsertOnConflict {
  const target = InsertOnConflict.on(
    conflict.columns.map((column) => ColumnRef.of(tableName, column)),
  );

  const set: Record<string, AnyExpression> = {};
  for (const column of conflict.updateColumns) {
    set[column] = ColumnRef.of('excluded', column);
  }
  if (Object.keys(conflict.updateDefaults).length > 0) {
    const { assignments } = toParamAssignments(
      contract,
      namespaceId,
      tableName,
      conflict.updateDefaults,
    );
    Object.assign(set, assignments);
  }

  return Object.keys(set).length === 0 ? target.doNothing() : target.doUpdateSet(set);
}

/**
 * Compiles a batched `INSERT ... VALUES (…), (…) ON CONFLICT … DO UPDATE SET`
 * with a RETURNING clause — one statement for N rows (ADR 003).
 *
 * With `DO NOTHING` (no update columns and no update defaults) the statement
 * returns only the rows it actually inserted; conflicting rows are absent.
 * Reloading them would mean a second statement, which this lane does not do.
 */
export function compileUpsertReturningMany(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  conflict: UpsertConflictResolution,
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const { rows: normalizedRows } = normalizeInsertRows(contract, namespaceId, tableName, rows);
  const ast = InsertAst.into(tableSourceForContract(contract, namespaceId, tableName))
    .withRows(normalizedRows)
    .withOnConflict(buildBatchedOnConflict(contract, namespaceId, tableName, conflict))
    .withReturning(buildReturningColumns(contract, namespaceId, tableName, returningColumns));

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

/**
 * Sibling of {@link compileInsertReturningSplit} for targets that cannot spell
 * `DEFAULT` inside `INSERT ... VALUES`: rows are grouped by their column
 * signature and each group becomes its own statement. The conflict resolution
 * is shared verbatim across the groups, so a column a group omits is still
 * assigned from `excluded` — the proposed row carries that column's default.
 */
export function compileUpsertReturningManySplit(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  rows: readonly Record<string, unknown>[],
  conflict: UpsertConflictResolution,
  returningColumns: readonly string[] | undefined,
): ReadonlyArray<SqlQueryPlan<Record<string, unknown>>> {
  if (rows.length === 0) {
    throw ormError('ORM.MUTATION_DATA_MISSING', 'upsertAll() requires at least one row', {
      meta: { method: 'upsertAll', namespaceId, tableName },
    });
  }
  return groupRowsByColumnSignature(rows).map((group) =>
    compileUpsertReturningMany(contract, namespaceId, tableName, group, conflict, returningColumns),
  );
}

export function compileUpdateReturning(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  const { assignments } = toParamAssignments(contract, namespaceId, tableName, setValues);
  let ast = UpdateAst.table(tableSourceForContract(contract, namespaceId, tableName))
    .withSet(assignments)
    .withReturning(buildReturningColumns(contract, namespaceId, tableName, returningColumns));
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileUpdateCount(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
  variantName?: string | undefined,
  modelName?: string | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = buildCountMutationWhere(
    contract,
    namespaceId,
    tableName,
    filters,
    variantName,
    modelName,
  );
  const { assignments } = toParamAssignments(contract, namespaceId, tableName, setValues);
  let ast = UpdateAst.table(tableSourceForContract(contract, namespaceId, tableName)).withSet(
    assignments,
  );
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileDeleteReturning(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  filters: readonly AnyExpression[],
  returningColumns: readonly string[] | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = combineWhereExprs(filters);
  let ast = DeleteAst.from(tableSourceForContract(contract, namespaceId, tableName)).withReturning(
    buildReturningColumns(contract, namespaceId, tableName, returningColumns),
  );
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}

export function compileDeleteCount(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  filters: readonly AnyExpression[],
  variantName?: string | undefined,
  modelName?: string | undefined,
): SqlQueryPlan<Record<string, unknown>> {
  const where = buildCountMutationWhere(
    contract,
    namespaceId,
    tableName,
    filters,
    variantName,
    modelName,
  );
  let ast = DeleteAst.from(tableSourceForContract(contract, namespaceId, tableName));
  if (where) {
    ast = ast.withWhere(where);
  }
  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params);
}
