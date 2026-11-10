import type { DiffSubjectGranularity } from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';

/**
 * The `nodeKind` discriminant for each relational schema-diff leaf node.
 * Each node carries a unique value; the differ pairs siblings by `id`, and
 * these kinds distinguish the node types that appear as `PostgresTableSchemaNode`
 * children (columns, primary key, foreign keys, uniques, indexes, checks) from
 * each other and from the RLS policy/role kinds a target defines separately.
 */
export const RelationalSchemaNodeKind = {
  schema: 'sql-schema',
  table: 'sql-table',
  column: 'sql-column',
  columnDefault: 'sql-column-default',
  primaryKey: 'sql-primary-key',
  foreignKey: 'sql-foreign-key',
  unique: 'sql-unique',
  index: 'sql-index',
  check: 'sql-check-constraint',
} as const;

export type RelationalSchemaNodeKind =
  (typeof RelationalSchemaNodeKind)[keyof typeof RelationalSchemaNodeKind];

/**
 * The one real map from a relational `nodeKind` to the framework-neutral
 * {@link DiffSubjectGranularity} its diff issues carry — the SQL family's
 * post-diff filters (issue category, strict-mode gating) and the framework
 * aggregate's unclaimed-elements sweep key on the granularity, never on the
 * `nodeKind` spelling and never on anything stamped on the node. Resolution
 * is by `nodeKind` equality against this map, not a suffix string match.
 * Target-specific node kinds (Postgres namespace/table/policy/role) are
 * outside this family layer's vocabulary and map their own kinds directly.
 */
const RELATIONAL_NODE_GRANULARITY: Readonly<
  Record<RelationalSchemaNodeKind, DiffSubjectGranularity>
> = {
  [RelationalSchemaNodeKind.schema]: 'structural',
  [RelationalSchemaNodeKind.table]: 'entity',
  [RelationalSchemaNodeKind.column]: 'field',
  [RelationalSchemaNodeKind.columnDefault]: 'auxiliary',
  [RelationalSchemaNodeKind.primaryKey]: 'auxiliary',
  [RelationalSchemaNodeKind.foreignKey]: 'auxiliary',
  [RelationalSchemaNodeKind.unique]: 'auxiliary',
  [RelationalSchemaNodeKind.index]: 'auxiliary',
  [RelationalSchemaNodeKind.check]: 'auxiliary',
};

function isRelationalSchemaNodeKind(nodeKind: string): nodeKind is RelationalSchemaNodeKind {
  return Object.hasOwn(RELATIONAL_NODE_GRANULARITY, nodeKind);
}

/**
 * Looks up the subject granularity for a relational `nodeKind`. Throws for a
 * `nodeKind` outside this map (a target-specific kind, e.g. Postgres's
 * namespace/table/policy/role) — those map their own kinds directly rather
 * than through this family-level map.
 */
export function relationalNodeGranularity(nodeKind: string): DiffSubjectGranularity {
  if (!isRelationalSchemaNodeKind(nodeKind)) {
    throw new InternalError(
      `relationalNodeGranularity: unrecognized relational node kind "${nodeKind}"`,
    );
  }
  return RELATIONAL_NODE_GRANULARITY[nodeKind];
}

/**
 * The one real map from a relational `nodeKind` to its storage `entityKind`
 * — the same vocabulary the contract storage's `entries` dictionary keys use
 * (`elementCoordinates` walks it). Only the whole-table kind has an entity of
 * its own; every other relational node (a column, an index, …) is nested
 * under one and maps to nothing here.
 */
const RELATIONAL_NODE_ENTITY_KIND: Partial<Readonly<Record<RelationalSchemaNodeKind, string>>> = {
  [RelationalSchemaNodeKind.table]: 'table',
};

/**
 * Looks up the storage `entityKind` for a relational `nodeKind` — sibling of
 * {@link relationalNodeGranularity}, resolved by `nodeKind` equality against
 * {@link RELATIONAL_NODE_ENTITY_KIND}. `undefined` for a target-specific kind
 * (targets map their own kinds directly) or a relational kind with no entity
 * of its own.
 */
export function relationalNodeEntityKind(nodeKind: string): string | undefined {
  return isRelationalSchemaNodeKind(nodeKind) ? RELATIONAL_NODE_ENTITY_KIND[nodeKind] : undefined;
}
