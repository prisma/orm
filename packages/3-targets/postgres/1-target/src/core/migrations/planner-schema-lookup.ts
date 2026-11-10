import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ForeignKey } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';

/**
 * Pre-computed lookup sets for a schema table's constraints.
 * Converts O(n*m) linear scans to O(1) Set lookups per constraint check.
 */
export interface SchemaTableLookup {
  readonly uniqueKeys: Set<string>;
  readonly indexKeys: Set<string>;
  readonly uniqueIndexKeys: Set<string>;
  readonly fkKeys: Set<string>;
}

export function buildSchemaLookupMap(schema: SqlSchemaIR): ReadonlyMap<string, SchemaTableLookup> {
  const map = new Map<string, SchemaTableLookup>();
  for (const [tableName, table] of Object.entries(schema.tables)) {
    map.set(tableName, buildSchemaTableLookup(table));
  }
  return map;
}

function buildSchemaTableLookup(table: SqlSchemaIR['tables'][string]): SchemaTableLookup {
  const uniqueKeys = new Set(table.uniques.map((u) => u.columns.join(',')));
  const indexKeys = new Set(table.indexes.map((i) => (i.columns ?? []).join(',')));
  const uniqueIndexKeys = new Set(
    table.indexes.filter((i) => i.unique).map((i) => (i.columns ?? []).join(',')),
  );
  const fkKeys = new Set<string>();
  for (const fk of table.foreignKeys) {
    // Keys are JSON-encoded tuples so identifiers containing any character
    // (including the column-list comma or pipe characters) cannot collide
    // across structurally-distinct FKs. Unqualified keys are 3-tuples
    // (cols, table, refCols); qualified keys are 4-tuples
    // (cols, schema, table, refCols) — the arity difference makes the two
    // key shapes fundamentally non-collidable.
    fkKeys.add(JSON.stringify([fk.columns, fk.referencedTable, fk.referencedColumns]));
    if (fk.referencedSchema !== undefined) {
      fkKeys.add(
        JSON.stringify([fk.columns, fk.referencedSchema, fk.referencedTable, fk.referencedColumns]),
      );
    }
  }
  return { uniqueKeys, indexKeys, uniqueIndexKeys, fkKeys };
}

export function hasUniqueConstraint(
  lookup: SchemaTableLookup,
  columns: readonly string[],
): boolean {
  const key = columns.join(',');
  return lookup.uniqueKeys.has(key) || lookup.uniqueIndexKeys.has(key);
}

export function hasIndex(lookup: SchemaTableLookup, columns: readonly string[]): boolean {
  const key = columns.join(',');
  return lookup.indexKeys.has(key) || lookup.uniqueKeys.has(key);
}

export function hasForeignKey(lookup: SchemaTableLookup, fk: ForeignKey): boolean {
  // Mirror the encoding produced by buildSchemaTableLookup exactly:
  // unqualified 3-tuple for unbound-namespace FKs, qualified 4-tuple for
  // bound-namespace FKs.
  if (fk.target.namespaceId === UNBOUND_NAMESPACE_ID) {
    return lookup.fkKeys.has(
      JSON.stringify([fk.source.columns, fk.target.tableName, fk.target.columns]),
    );
  }
  return lookup.fkKeys.has(
    JSON.stringify([
      fk.source.columns,
      fk.target.namespaceId,
      fk.target.tableName,
      fk.target.columns,
    ]),
  );
}
