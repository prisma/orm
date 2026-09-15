import {
  backingIndexColumnKeys,
  isBackedByColumnKeys,
} from '@internal/sql-contract/foreign-key-materialization';
import type { SqlForeignKeyIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { deriveBackRelationFieldName, deriveRelationFieldName, pluralize } from './name-transforms';
import type { RelationField } from './printer-config';

const DEFAULT_ON_DELETE = 'noAction';
const DEFAULT_ON_UPDATE = 'noAction';

const REFERENTIAL_ACTION_PSL: Record<string, string> = {
  noAction: 'NoAction',
  restrict: 'Restrict',
  cascade: 'Cascade',
  setNull: 'SetNull',
  setDefault: 'SetDefault',
};

export type InferredRelations = {
  readonly relationsByTable: ReadonlyMap<string, readonly RelationField[]>;
};

export function inferRelations(
  tables: Record<string, SqlTableIR>,
  modelNameMap: ReadonlyMap<string, string>,
): InferredRelations {
  const relationsByTable = new Map<string, RelationField[]>();

  const fkCountByPair = new Map<string, number>();
  for (const table of Object.values(tables)) {
    for (const fk of table.foreignKeys) {
      const pairKey = `${table.name}→${fk.referencedTable}`;
      fkCountByPair.set(pairKey, (fkCountByPair.get(pairKey) ?? 0) + 1);
    }
  }

  const usedFieldNames = new Map<string, Set<string>>();
  for (const table of Object.values(tables)) {
    const names = new Set<string>();
    for (const col of Object.values(table.columns)) {
      names.add(col.name);
    }
    usedFieldNames.set(table.name, names);
  }

  for (const table of Object.values(tables)) {
    for (const fk of table.foreignKeys) {
      const childTableName = table.name;
      const parentTableName = fk.referencedTable;
      const childUsed = usedFieldNames.get(childTableName) as Set<string>;
      const childModelName = modelNameMap.get(childTableName) ?? childTableName;
      const parentModelName = modelNameMap.get(parentTableName) ?? parentTableName;
      const pairKey = `${childTableName}→${parentTableName}`;
      const isSelfRelation = childTableName === parentTableName;
      const needsRelationName = (fkCountByPair.get(pairKey) as number) > 1 || isSelfRelation;

      const isOneToOne = detectOneToOne(fk, table);

      const childRelFieldName = resolveUniqueFieldName(
        deriveRelationFieldName(fk.columns, parentTableName),
        childUsed,
        parentModelName,
      );
      const relationName = needsRelationName
        ? deriveRelationName(fk, childRelFieldName, parentModelName, isSelfRelation)
        : undefined;
      const childOptional = fk.columns.some(
        (columnName) => table.columns[columnName]?.nullable ?? false,
      );

      const childRelField = buildChildRelationField(
        childRelFieldName,
        parentModelName,
        fk,
        childOptional,
        relationName,
        table,
      );

      addRelationField(relationsByTable, childTableName, childRelField);
      childUsed.add(childRelFieldName);

      const parentUsed = usedFieldNames.get(parentTableName) ?? new Set();
      usedFieldNames.set(parentTableName, parentUsed);

      const backRelFieldName = resolveUniqueFieldName(
        deriveBackRelationFieldName(childModelName, isOneToOne),
        parentUsed,
        childModelName,
      );

      const backRelField: RelationField = {
        fieldName: backRelFieldName,
        typeName: childModelName,
        optional: isOneToOne,
        list: !isOneToOne,
        relationName,
      };

      addRelationField(relationsByTable, parentTableName, backRelField);
      parentUsed.add(backRelFieldName);
    }
  }

  return { relationsByTable };
}

function detectOneToOne(fk: SqlForeignKeyIR, table: SqlTableIR): boolean {
  const fkCols = [...fk.columns].sort();

  if (table.primaryKey) {
    const pkCols = [...table.primaryKey.columns].sort();
    if (pkCols.length === fkCols.length && pkCols.every((c, i) => c === fkCols[i])) {
      return true;
    }
  }

  for (const unique of table.uniques) {
    const uniqueCols = [...unique.columns].sort();
    if (uniqueCols.length === fkCols.length && uniqueCols.every((c, i) => c === fkCols[i])) {
      return true;
    }
  }

  for (const index of table.indexes) {
    if (!index.unique || index.partial || index.columns === undefined) {
      continue;
    }
    const indexCols = [...index.columns].sort();
    if (indexCols.length === fkCols.length && indexCols.every((c, i) => c === fkCols[i])) {
      return true;
    }
  }

  return false;
}

function deriveRelationName(
  fk: SqlForeignKeyIR,
  childRelationFieldName: string,
  parentModelName: string,
  isSelfRelation: boolean,
): string {
  if (fk.name) {
    return fk.name;
  }
  if (isSelfRelation) {
    return `${childRelationFieldName.charAt(0).toUpperCase() + childRelationFieldName.slice(1)}${pluralize(parentModelName)}`;
  }
  return fk.columns.join('_');
}

/**
 * Builds the child-side {@link RelationField} for a single foreign key:
 * `typeName` is the parent model name, `fields`/`references` are the FK's raw
 * columns, and `onDelete`/`onUpdate` are normalized to their PSL spelling.
 * Exported so a caller resolving a foreign key against a model outside
 * `tables` (e.g. a cross-space reference into another contract) can reuse the
 * same normalization instead of duplicating it.
 *
 * `hostTable` is the table the FK is declared on (i.e. `table`, not the
 * referenced parent) — its own indexes/uniques/primary key are what a
 * backing index for this FK would be. When none of them exactly match the
 * FK's source columns (in order), `index: false` is stamped so the emitted
 * `@relation` opts out of the framework's default derived backing-index
 * expectation, matching what `db verify` will find live. Passing the table
 * is optional so existing single-FK callers (e.g. cross-space resolution
 * before a host table reference is threaded through) can omit it and keep
 * the framework default.
 */
export function buildChildRelationField(
  fieldName: string,
  parentModelName: string,
  fk: SqlForeignKeyIR,
  optional: boolean,
  relationName?: string,
  hostTable?: SqlTableIR,
): RelationField {
  const onDelete = fk.onDelete && fk.onDelete !== DEFAULT_ON_DELETE ? fk.onDelete : undefined;
  const onUpdate = fk.onUpdate && fk.onUpdate !== DEFAULT_ON_UPDATE ? fk.onUpdate : undefined;
  const index =
    hostTable &&
    !isBackedByColumnKeys(
      fk.columns,
      // Only indexes the inferrer actually emits can back the FK in the
      // emitted contract: partial indexes (and expression indexes, which
      // carry no column tuple) are not emitted yet, so
      // they must not suppress the explicit `index: false`.
      backingIndexColumnKeys({
        indexes: hostTable.indexes.filter((i) => i.where === undefined),
        uniques: hostTable.uniques,
        primaryKey: hostTable.primaryKey,
      }),
    )
      ? false
      : undefined;

  return {
    fieldName,
    typeName: parentModelName,
    referencedTableName: fk.referencedTable,
    optional,
    list: false,
    relationName,
    fkName: fk.name,
    fields: fk.columns,
    references: fk.referencedColumns,
    onDelete: onDelete ? REFERENTIAL_ACTION_PSL[onDelete] : undefined,
    onUpdate: onUpdate ? REFERENTIAL_ACTION_PSL[onUpdate] : undefined,
    index,
  };
}

function resolveUniqueFieldName(
  desired: string,
  usedNames: ReadonlySet<string>,
  fallbackSuffix: string,
): string {
  if (!usedNames.has(desired)) {
    return desired;
  }

  const withSuffix = `${desired}${fallbackSuffix}`;
  if (!usedNames.has(withSuffix)) {
    return withSuffix;
  }

  let counter = 2;
  while (usedNames.has(`${desired}${counter}`)) {
    counter++;
  }
  return `${desired}${counter}`;
}

function addRelationField(
  map: Map<string, RelationField[]>,
  tableName: string,
  field: RelationField,
): void {
  const existing = map.get(tableName);
  if (existing) {
    existing.push(field);
  } else {
    map.set(tableName, [field]);
  }
}
