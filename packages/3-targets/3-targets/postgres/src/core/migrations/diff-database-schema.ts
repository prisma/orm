import type { Contract, ControlPolicy } from '@internal/contract/types';
import type { SqlSchemaDiffResult } from '@internal/family-sql/control';
import { buildDataTypeResolver } from '@internal/family-sql/control';
import { classifyDiffSubjectGranularity } from '@internal/family-sql/diff';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type { DiffableNode, SchemaDiffIssue } from '@internal/framework-components/control';
import { diffSchemas, issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { postgresResolveDefault } from '../default-normalizer';
import type { PostgresContract } from '../postgres-schema';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import {
  postgresDiffSubjectGranularity,
  type SqlSchemaDiffNode,
} from '../schema-ir/schema-node-kinds';
import { contractToPostgresDatabaseSchemaNode } from './contract-to-postgres-database-schema-node';
import { resolvePostgresNodeIssueControlPolicySubject } from './control-policy';
import { buildPostgresNativeTypeExpander } from './native-type-expander';

/**
 * Whether a diff issue's subject node is cluster-scoped — it carries its own
 * `namespaceId` field (only role and policy diff nodes do) and that
 * coordinate is the unbound sentinel, meaning the node is not owned by any
 * schema/namespace. A role node is always cluster-scoped (roles are
 * cluster-level objects); a policy node's `namespaceId` is always its
 * table's resolved DDL schema, never the sentinel. Namespace-ownership
 * scoping (which compares `issue.path[1]` against the set of DDL schemas
 * the contract owns) makes no sense for a cluster-scoped subject — its path
 * segment at that index is the object's own name, not a schema name — so
 * such an issue bypasses that scoping entirely.
 */
function isClusterScopedIssue(issue: SchemaDiffIssue): boolean {
  const node = issue.expected ?? issue.actual;
  return node !== undefined && nodeNamespaceId(node) === UNBOUND_NAMESPACE_ID;
}

function nodeNamespaceId(node: DiffableNode): string | undefined {
  if (!Object.hasOwn(node, 'namespaceId')) return undefined;
  return blindCast<
    { namespaceId: string },
    'presence of an own namespaceId field was just checked via Object.hasOwn'
  >(node).namespaceId;
}

function ownedSchemaNames(expected: PostgresDatabaseSchemaNode): ReadonlySet<string> {
  const policyNamespaces = Object.values(expected.namespaces).flatMap((ns) =>
    Object.values(ns.tables).flatMap((t) => t.policies.map((p) => p.namespaceId)),
  );
  return new Set([...policyNamespaces, ...expected.existingSchemas]);
}

/**
 * Drops contract namespaces that declare no tables from the verdict-diff
 * expected tree and the relational owned-schema set. The legacy relational
 * walk skipped a table-less namespace (e.g. an enums-only schema) before
 * pairing, so neither its DDL schema's absence nor that schema's live
 * relational contents ever reached the verdict — the pruned tree
 * reproduces that. The prune loses no expected policies: policies attach
 * to tables, so a table-less namespace carries none (the projection
 * throws on a policy referencing an absent table). Live policies in a
 * pruned schema remain governed via the full owned set (see
 * {@link diffPostgresSchema}).
 */
function pruneTableLessNamespaces(
  expected: PostgresDatabaseSchemaNode,
): PostgresDatabaseSchemaNode {
  const namespaces = Object.fromEntries(
    Object.entries(expected.namespaces).filter(([, ns]) => Object.keys(ns.tables).length > 0),
  );
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [...expected.roles],
    existingSchemas: expected.existingSchemas.filter((s) => namespaces[s] !== undefined),
    pgVersion: expected.pgVersion,
  });
}

/**
 * Resolves a verdict-diff issue's subject's declared control policy directly
 * from the contract, by delegating to the same node-typed resolver
 * ({@link resolvePostgresNodeIssueControlPolicySubject}) the planner uses to
 * gate DDL calls. `undefined` when the issue resolves to no contract subject.
 *
 * A role issue resolves through that same resolver to `external`
 * unconditionally (see its role branch), regardless of the contract's own
 * default policy: a role is referenced by the contract but not owned, and
 * `external`'s existing semantics — a missing declared subject still fails,
 * every extra is suppressed — are exactly the wanted asymmetric grading for
 * a cluster object the framework does not own.
 */
function resolveControlPolicy(
  issue: SchemaDiffIssue,
  contract: Contract<SqlStorage>,
): ControlPolicy | undefined {
  const nodeIssue = blindCast<
    SchemaDiffIssue<SqlSchemaDiffNode>,
    'every node in a Postgres schema diff tree is a SqlSchemaDiffNode'
  >(issue);
  return resolvePostgresNodeIssueControlPolicySubject(nodeIssue, contract)
    ?.explicitNodeControlPolicy;
}

/**
 * The Postgres full-tree node diff for the family verify verdict: derive
 * the expected tree (resolved leaf values, expander threaded, FK schemas
 * resolved, table-less namespaces pruned), run the generic
 * differ over the trees as derived, and scope out `not-expected` findings under namespaces the
 * contract does not own. Ownership scoping bypasses cluster-scoped subjects
 * (roles today), mirroring the legacy decomposition: relational extras check
 * the PRUNED owned set (the legacy
 * per-namespace walk never visited a table-less namespace, so its live
 * relational contents are invisible), while `structural` extras (RLS
 * policies) check the FULL owned set (the legacy policy diff governed
 * every contract schema regardless of tables — RLS governance does not
 * shrink because a namespace declares no tables). The codec `verifyType`
 * hooks run once per contract namespace with tables against that
 * namespace's paired actual node (the hooks read namespace-scoped state
 * such as `nativeEnums`).
 */
export function diffPostgresSchema(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): SqlSchemaDiffResult {
  const postgresContract = blindCast<
    PostgresContract,
    'diffPostgresSchema is only called with a postgres contract'
  >(input.contract);
  PostgresDatabaseSchemaNode.assert(input.schema);
  const actual = input.schema;
  const expandNativeType = buildPostgresNativeTypeExpander(input.frameworkComponents);
  const fullExpected = contractToPostgresDatabaseSchemaNode(postgresContract, {
    annotationNamespace: 'pg',
    expandNativeType,
    resolveDefault: postgresResolveDefault,
    ...ifDefined('dataTypeOf', buildDataTypeResolver(input.frameworkComponents)),
  });
  const expected = pruneTableLessNamespaces(fullExpected);
  const relationalOwned = ownedSchemaNames(expected);
  const structuralOwned = ownedSchemaNames(fullExpected);
  const issues = diffSchemas(expected, actual).filter((issue) => {
    if (issueOutcome(issue) !== 'not-expected') return true;
    if (isClusterScopedIssue(issue)) return true;
    const granularity = classifyDiffSubjectGranularity(issue, postgresDiffSubjectGranularity);
    const namespaceSegment = issue.path[1];
    if (namespaceSegment === undefined) return true;
    const owned = granularity === 'structural' ? structuralOwned : relationalOwned;
    return owned.has(namespaceSegment);
  });
  const namespacePairs = Object.values(expected.namespaces).map((ns) => ({
    actual: actual.namespaces[ns.schemaName],
  }));
  return {
    issues,
    resolveControlPolicy: (issue) => resolveControlPolicy(issue, postgresContract),
    namespacePairs,
  };
}

/**
 * Adds an empty namespace node to the actual tree for every expected namespace
 * absent from it. The relational plan diff pairs on namespace: a contract
 * namespace whose live schema does not exist yet must surface each of its
 * tables as `not-found` (→ `CREATE TABLE`), NOT as a single namespace
 * `not-found` that subtree-coalescing would collapse (leaving `CREATE SCHEMA`
 * with no tables). Padding makes the namespaces pair, so only table/column/
 * policy drift surfaces; `CREATE SCHEMA` comes separately from the synthesized
 * namespace-presence stitch (`verifyPostgresNamespacePresence`), never from the
 * tree diff — matching the retired per-namespace-paired relational walk, which
 * paired a missing schema against an empty namespace node.
 */
function padActualNamespaces(
  expected: PostgresDatabaseSchemaNode,
  actual: PostgresDatabaseSchemaNode,
): PostgresDatabaseSchemaNode {
  const namespaces: Record<string, PostgresNamespaceSchemaNode> = { ...actual.namespaces };
  let padded = false;
  for (const schemaName of Object.keys(expected.namespaces)) {
    if (namespaces[schemaName] === undefined) {
      namespaces[schemaName] = new PostgresNamespaceSchemaNode({
        schemaName,
        tables: {},
      });
      padded = true;
    }
  }
  if (!padded) return actual;
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [...actual.roles],
    existingSchemas: [...actual.existingSchemas],
    pgVersion: actual.pgVersion,
  });
}

export interface PostgresPlanDiff {
  /** The desired ("end") tree — resolved leaf values (incl. `codecRef`) on every column, table-less namespaces pruned. */
  readonly expected: PostgresDatabaseSchemaNode;
  /** The live ("start") tree, padded with empty namespaces so a missing schema's tables pair. */
  readonly actual: PostgresDatabaseSchemaNode;
  /** The one node diff over the two trees: relational + policy drift, cluster-scope-aware ownership filtered. */
  readonly issues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[];
}

/**
 * The Postgres planner's diff input: the SAME tree-building
 * `diffPostgresSchema` uses (expander threaded, FK schemas resolved,
 * table-less namespaces pruned, cluster-scope-aware ownership filter) plus
 * actual namespace padding (so a missing
 * schema's tables surface as `not-found` instead of a swallowed namespace
 * `not-found`). One differ drives both verify and plan; this is the
 * plan-side derivation. The single issue list covers tables / columns /
 * constraints / indexes / defaults AND policies — the caller splits it
 * (relational → `mapNodeIssueToCall`; policy → RLS ops) and stitches in
 * `CREATE SCHEMA` separately.
 */
export function buildPostgresPlanDiff(input: {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): PostgresPlanDiff {
  const postgresContract = blindCast<
    PostgresContract,
    'buildPostgresPlanDiff is only called with a postgres contract'
  >(input.contract);
  PostgresDatabaseSchemaNode.assert(input.actualSchema);
  const actual = input.actualSchema;
  const expandNativeType = buildPostgresNativeTypeExpander(input.frameworkComponents);
  const projectionOptions = {
    annotationNamespace: 'pg',
    expandNativeType,
    resolveDefault: postgresResolveDefault,
    ...ifDefined('dataTypeOf', buildDataTypeResolver(input.frameworkComponents)),
  };
  const fullExpected = contractToPostgresDatabaseSchemaNode(postgresContract, projectionOptions);
  const expected = pruneTableLessNamespaces(fullExpected);
  const paddedActual = padActualNamespaces(expected, actual);
  const relationalOwned = ownedSchemaNames(expected);
  const structuralOwned = ownedSchemaNames(fullExpected);
  const issues = blindCast<
    readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
    'both trees are PostgresDatabaseSchemaNodes, so every diff-issue node is a SqlSchemaDiffNode'
  >(diffSchemas(expected, paddedActual)).filter((issue) => {
    if (issueOutcome(issue) !== 'not-expected') return true;
    if (isClusterScopedIssue(issue)) return true;
    const granularity = classifyDiffSubjectGranularity(issue, postgresDiffSubjectGranularity);
    const namespaceSegment = issue.path[1];
    if (namespaceSegment === undefined) return true;
    const owned = granularity === 'structural' ? structuralOwned : relationalOwned;
    return owned.has(namespaceSegment);
  });
  return { expected, actual: paddedActual, issues };
}
