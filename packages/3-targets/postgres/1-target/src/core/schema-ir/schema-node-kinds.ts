import type { DiffableNode, DiffSubjectGranularity } from '@internal/framework-components/control';
import {
  relationalNodeEntityKind,
  relationalNodeGranularity,
  type SqlSchemaIRNode,
} from '@internal/sql-schema-ir/types';

/**
 * A Postgres schema-diff-tree node: a `SqlSchemaIRNode` that also implements
 * `DiffableNode` (the five `Postgres*SchemaNode` classes). `SqlSchemaIRNode`
 * alone is not a `DiffableNode` — its relational subclasses (`SqlColumnIR`, …)
 * carry no `id`/`isEqualTo`/`children` — so this intersection is the honest node
 * type the differ produces and the planner consumes (`SchemaDiff<SqlSchemaDiffNode>`).
 */
export type SqlSchemaDiffNode = SqlSchemaIRNode & DiffableNode;

/**
 * The `nodeKind` discriminant for each Postgres schema-diff node. Each node
 * carries a unique value; the static `is`/`assert` guards compare against these
 * identifiers rather than spelling the string inline or using `instanceof`. The
 * field is an enumerable own property carried on every node instance.
 */
export const PostgresSchemaNodeKind = {
  database: 'postgres-database',
  namespace: 'postgres-namespace',
  table: 'postgres-table',
  policy: 'postgres-policy',
  role: 'postgres-role',
  nativeEnum: 'postgres-native-enum',
  extension: 'postgres-extension',
} as const;

export type PostgresSchemaNodeKind =
  (typeof PostgresSchemaNodeKind)[keyof typeof PostgresSchemaNodeKind];

/**
 * The one real map from a Postgres-specific `nodeKind` to the
 * framework-neutral {@link DiffSubjectGranularity} its diff issues carry —
 * resolution is by `nodeKind` equality against this map, never a
 * `nodeKind`-suffix string match and never anything stamped on the node.
 */
const POSTGRES_NODE_GRANULARITY: Readonly<Record<PostgresSchemaNodeKind, DiffSubjectGranularity>> =
  {
    [PostgresSchemaNodeKind.database]: 'structural',
    [PostgresSchemaNodeKind.namespace]: 'namespace',
    [PostgresSchemaNodeKind.table]: 'entity',
    // A policy set is owned by the managed table it attaches to; a role is
    // referenced by the contract but not owned (the framework names it in a
    // policy but never owns the cluster's role list). Both classify as
    // `structural`. The asymmetry for roles — a missing declared one fails, an
    // undeclared live one is tolerated unconditionally — comes from the
    // control policy the diff resolves a role issue against (`external`),
    // not from the granularity.
    [PostgresSchemaNodeKind.policy]: 'structural',
    [PostgresSchemaNodeKind.role]: 'structural',
    [PostgresSchemaNodeKind.nativeEnum]: 'entity',
    [PostgresSchemaNodeKind.extension]: 'entity',
  };

function isPostgresSchemaNodeKind(nodeKind: string): nodeKind is PostgresSchemaNodeKind {
  return Object.hasOwn(POSTGRES_NODE_GRANULARITY, nodeKind);
}

/** Looks up the subject granularity for a Postgres-specific `nodeKind`. */
export function postgresNodeGranularity(nodeKind: PostgresSchemaNodeKind): DiffSubjectGranularity {
  return POSTGRES_NODE_GRANULARITY[nodeKind];
}

/**
 * The subject granularity for any node kind that appears in a Postgres diff
 * tree — the tree mixes Postgres-specific kinds (database/namespace/table/
 * policy/role) with the relational leaf kinds (columns, constraints, indexes,
 * …), so this dispatches to whichever family/target map owns the kind. Called
 * on demand by consumers (the family verdict, the framework aggregate's
 * unclaimed-elements sweep, via the {@link
 * import('@internal/framework-components/control').SchemaSubjectClassifierCapable}
 * capability) — never stamped onto the issue or the node.
 */
export function postgresDiffSubjectGranularity(nodeKind: string): DiffSubjectGranularity {
  return isPostgresSchemaNodeKind(nodeKind)
    ? postgresNodeGranularity(nodeKind)
    : relationalNodeGranularity(nodeKind);
}

/**
 * The map from a Postgres-specific `nodeKind` to its storage `entityKind` — the
 * same vocabulary the contract storage's `entries` dictionary keys use. The
 * whole-table and native-enum kinds each have an entity of their own;
 * database/namespace/policy/role nodes map to nothing here (a namespace is
 * addressed by id, not by an `entries` kind; policies and roles are
 * structural, never a sibling space's unclaimed entity).
 *
 * The native enum keys under its PHYSICAL type name in `entries.native_enum`
 * (ADR 221), so its diff node's `typeName` addresses the entity on the generic
 * coordinate directly — no by-type-name walk needed. This lets the framework's
 * unclaimed-elements sweep classify enum ownership the same coordinate way it
 * classifies tables.
 */
const POSTGRES_NODE_ENTITY_KIND: Partial<Readonly<Record<PostgresSchemaNodeKind, string>>> = {
  [PostgresSchemaNodeKind.table]: 'table',
  [PostgresSchemaNodeKind.nativeEnum]: 'native_enum',
  [PostgresSchemaNodeKind.extension]: 'extension',
};

/** Looks up the storage entityKind for a Postgres-specific `nodeKind`. */
export function postgresNodeEntityKind(nodeKind: PostgresSchemaNodeKind): string | undefined {
  return POSTGRES_NODE_ENTITY_KIND[nodeKind];
}

/**
 * The storage `entityKind` for any node kind that appears in a Postgres diff
 * tree — sibling of {@link postgresDiffSubjectGranularity}, dispatching the
 * same way to whichever family/target map owns the kind. Called on demand by
 * the framework aggregate's unclaimed-elements sweep via the {@link
 * import('@internal/framework-components/control').SchemaSubjectClassifierCapable}
 * capability — never stamped onto the issue or the node.
 */
export function postgresDiffSubjectEntityKind(nodeKind: string): string | undefined {
  return isPostgresSchemaNodeKind(nodeKind)
    ? postgresNodeEntityKind(nodeKind)
    : relationalNodeEntityKind(nodeKind);
}
