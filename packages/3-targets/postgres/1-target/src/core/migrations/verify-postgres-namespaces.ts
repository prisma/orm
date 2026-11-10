import type { Contract } from '@internal/contract/types';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import { isPostgresSchema } from '../postgres-schema';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import type { SqlSchemaDiffNode } from '../schema-ir/schema-node-kinds';

/**
 * Resolves the live-database schema name for a given namespace
 * coordinate. Mirrors `resolveDdlSchemaForNamespace` in
 * `planner-strategies.ts` so the verifier's projection and the
 * planner's projection always agree — Postgres-aware namespaces (the
 * production path) dispatch to `ddlSchemaName(storage)`, and bare
 * object payloads (used by some tests) fall back to the coordinate
 * itself.
 */
function resolveDdlSchemaName(storage: SqlStorage, namespaceId: string): string {
  const namespace = storage.namespaces[namespaceId];
  if (isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  return namespaceId;
}

/**
 * Reads the introspected list of schema names from the database-root schema
 * node. `existingSchemas` is database-level, so it lives on the
 * `PostgresDatabaseSchemaNode` root — not on the per-schema namespace nodes.
 *
 * Defaults to the always-present `public` schema when the node is not the
 * database root — a fresh Postgres database always carries `public` (unless an
 * operator dropped it manually), so any verifier path that runs without an
 * enriched introspection still suppresses the redundant `CREATE SCHEMA
 * "public"`.
 *
 * Production introspection (`PostgresControlAdapter.introspect`) is the
 * authoritative source: it queries `pg_namespace` and sets `existingSchemas`
 * on the returned root. Tests that want to assert against a richer initial
 * state construct a `PostgresDatabaseSchemaNode` explicitly.
 */
function existingSchemasFromSchema(schema: SqlSchemaIRNode): readonly string[] {
  if (PostgresDatabaseSchemaNode.is(schema)) {
    return schema.existingSchemas;
  }
  return [DEFAULT_NAMESPACE_ID];
}

/**
 * Emits a `postgres-namespace` `not-found` diff issue for every
 * contract-declared Postgres namespace whose live container does not yet
 * exist. The planner prepends these (node-typed, synthesized) to the
 * relational diff issues so a multi-schema plan emits `CREATE SCHEMA`
 * before the tables that need it — a planner-only concern (verify already
 * rejects via the `not-found` table issues a missing schema already
 * produces), so this is not part of the shared diff.
 *
 * A namespace's live container is the schema returned by its
 * polymorphic `ddlSchemaName(storage)` method — named schemas resolve
 * to their own id; the unbound singleton returns `UNBOUND_NAMESPACE_ID`
 * and is skipped explicitly (late-bound namespaces have no fixed DDL
 * schema). Issues are emitted only when the resolved name is a real,
 * creatable schema (not the unbound sentinel) and is missing from the
 * introspected list. `public` is suppressed implicitly because the
 * introspection (or its sensible default) always carries it.
 *
 * Each emitted issue's path is `['database', ddlName]` — an ancestor of
 * every table path under that schema, so it must never be run through
 * `coalesceSubtreeIssues` alongside the table diff (it would swallow the
 * table-level `not-found` issues that drive `CREATE TABLE`); the planner
 * adds these AFTER coalescing the relational issues, and they are not
 * subject to sibling-space ownership scoping (mirrors the retired
 * coordinate walk, which prepended namespace issues after that filter).
 */
export function verifyPostgresNamespacePresence(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
}): readonly SchemaDiffIssue<SqlSchemaDiffNode>[] {
  const { contract, schema } = input;
  const existing = new Set(existingSchemasFromSchema(schema));
  const issues: SchemaDiffIssue<SqlSchemaDiffNode>[] = [];
  const namespaceIds = Object.keys(contract.storage.namespaces).sort();
  for (const namespaceId of namespaceIds) {
    if (namespaceId === UNBOUND_NAMESPACE_ID) continue;
    const ddlName = resolveDdlSchemaName(contract.storage, namespaceId);
    if (ddlName === UNBOUND_NAMESPACE_ID) continue;
    if (existing.has(ddlName)) continue;
    const namespace = new PostgresNamespaceSchemaNode({
      schemaName: ddlName,
      tables: {},
    });
    issues.push({
      path: ['database', ddlName],
      expected: namespace,
    });
  }
  return issues;
}
