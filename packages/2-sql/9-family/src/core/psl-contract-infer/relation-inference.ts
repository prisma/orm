import type { SqlForeignKeyIR, SqlIndexIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { InternalError } from '@internal/utils/internal-error';
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

/** Whether a live index is of the target's default kind, the kind the backing index `contract emit` derives for a relation has. */
export type IsDefaultIndexKind = (index: SqlIndexIR) => boolean;

export function inferRelations(
  tables: Record<string, SqlTableIR>,
  modelNameMap: ReadonlyMap<string, string>,
  isDefaultIndexKind: IsDefaultIndexKind,
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
      const childUsed = usedFieldNames.get(childTableName);
      if (childUsed === undefined) {
        throw new InternalError(`Missing inferred field-name set for table "${childTableName}"`);
      }
      const childModelName = modelNameMap.get(childTableName) ?? childTableName;
      const parentModelName = modelNameMap.get(parentTableName) ?? parentTableName;
      const pairKey = `${childTableName}→${parentTableName}`;
      const isSelfRelation = childTableName === parentTableName;
      const needsRelationName = (fkCountByPair.get(pairKey) ?? 0) > 1 || isSelfRelation;

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
        { table, isDefaultIndexKind },
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
 * `host.table` is the table the FK is declared on (not the referenced
 * parent). `contract emit` derives a backing index for every relation and
 * drops it again when the table has an identical index or a unique
 * constraint, unique index or primary key on the same columns. When the live
 * table has none of those, `index: false` is stamped so the emitted contract
 * expects no index the database lacks. Without a host, the relation keeps
 * the default.
 */
export function buildChildRelationField(
  fieldName: string,
  parentModelName: string,
  fk: SqlForeignKeyIR,
  optional: boolean,
  relationName?: string,
  host?: { readonly table: SqlTableIR; readonly isDefaultIndexKind: IsDefaultIndexKind },
): RelationField {
  const onDelete = fk.onDelete && fk.onDelete !== DEFAULT_ON_DELETE ? fk.onDelete : undefined;
  const onUpdate = fk.onUpdate && fk.onUpdate !== DEFAULT_ON_UPDATE ? fk.onUpdate : undefined;
  const index =
    host !== undefined && !servesDerivedBackingIndex(fk.columns, host) ? false : undefined;

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

function servesDerivedBackingIndex(
  columns: readonly string[],
  host: { readonly table: SqlTableIR; readonly isDefaultIndexKind: IsDefaultIndexKind },
): boolean {
  const { table } = host;
  const onColumns = (candidate: readonly string[] | undefined) =>
    candidate !== undefined &&
    candidate.length === columns.length &&
    candidate.every((column, position) => column === columns[position]);
  return (
    onColumns(table.primaryKey?.columns) ||
    table.uniques.some((unique) => onColumns(unique.columns)) ||
    table.indexes.some(
      (index) =>
        onColumns(index.columns) &&
        index.where === undefined &&
        (index.unique || (index.options === undefined && host.isDefaultIndexKind(index))),
    )
  );
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
