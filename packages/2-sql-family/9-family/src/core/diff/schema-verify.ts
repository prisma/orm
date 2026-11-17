/**
 * The differ-based SQL schema verify: post-diff filters and verdict.
 *
 * The generic node differ (`diffSchemas`) reports every node-level
 * difference between the derived expected tree and the introspected actual
 * tree. This module is the consumer side the spec assigns to the SQL
 * family: strict-mode extras gating and control-policy disposition are
 * reason/kind-keyed filters applied AFTER the diff — never inside it — and
 * the verify verdict derives from the filtered issue list.
 *
 * `verifySqlSchemaByDiff` wraps the verdict in the issue-based result
 * envelope — this is THE SQL schema verify (the legacy relational walk and
 * its verification tree are retired).
 */

import type { Contract, ControlPolicy } from '@internal/contract/types';
import { effectiveControlPolicy } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  DiffSubjectGranularity,
  SchemaDiffIssue,
  VerifierIssueCategory,
  VerifierOutcome,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import {
  dispositionForCategory,
  issueOutcome,
  VERIFY_CODE_SCHEMA_FAILURE,
} from '@internal/framework-components/control';
import { isStorageTypeInstance, type SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { extractCodecControlHooks } from '../assembly';
import type { SqlSchemaDiffFn } from '../migrations/schema-differ';
import type { CodecControlHooks } from '../migrations/types';
import { verifierDisposition } from './verifier-disposition';

// ============================================================================
// Subject-granularity classification — nodeKind → framework-neutral granularity
// ============================================================================

function issueNode(issue: SchemaDiffIssue): SqlSchemaIRNode | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    SqlSchemaIRNode,
    'every node in a SQL schema diff tree is a SqlSchemaIRNode; nodeKind is its identity'
  >(node);
}

/**
 * Resolves an issue's framework-neutral {@link DiffSubjectGranularity} on
 * demand, from the issue's node's `nodeKind` via the target-provided
 * `granularityOf` map. The node carries only its `nodeKind` identity, never a
 * classification, and nothing is stamped onto the issue — every consumer
 * (the family verdict below, the framework aggregate's unclaimed-elements
 * sweep via {@link import('@internal/framework-components/control').SchemaSubjectClassifierCapable})
 * calls this the same way, resolved by the family/target that owns the node
 * vocabulary. `undefined` for an issue with no node.
 */
export function classifyDiffSubjectGranularity(
  issue: SchemaDiffIssue,
  granularityOf: (nodeKind: string) => DiffSubjectGranularity,
): DiffSubjectGranularity | undefined {
  const node = issueNode(issue);
  return node === undefined ? undefined : granularityOf(node.nodeKind);
}

/**
 * Resolves an issue's storage `entityKind` on demand, from the issue's
 * node's `nodeKind` via the target-provided `entityKindOf` map — the sibling
 * of {@link classifyDiffSubjectGranularity}, called the same way by the same
 * consumers (via
 * {@link import('@internal/framework-components/control').SchemaSubjectClassifierCapable}).
 * `undefined` for an issue with no node, or for a node kind with no storage
 * entity of its own.
 */
export function classifyDiffEntityKind(
  issue: SchemaDiffIssue,
  entityKindOf: (nodeKind: string) => string | undefined,
): string | undefined {
  const node = issueNode(issue);
  return node === undefined ? undefined : entityKindOf(node.nodeKind);
}

// ============================================================================
// Issue classification — subject granularity + reason → target-neutral category
// ============================================================================

/**
 * Re-keys the legacy `classifySqlVerifierIssueKind` category mapping on the
 * issue's {@link DiffSubjectGranularity} (resolved via `granularityOf`) + the
 * issue reason. The vocabulary maps one-to-one: an undeclared live entity or
 * namespace is `extraTopLevelObject`, an undeclared live field
 * `extraNestedElement`, undeclared auxiliaries (constraints, indexes,
 * defaults) and structural leaves (policies) `extraAuxiliary`; every paired
 * divergence is `declaredIncompatible`; anything the database lacks is
 * `declaredMissing`.
 * `granularityOf` is the target's classifier, so target and extension node
 * kinds classify without the family importing them.
 */
export function classifySqlDiffIssue(
  issue: SchemaDiffIssue,
  granularityOf: (nodeKind: string) => DiffSubjectGranularity,
): VerifierIssueCategory {
  if (issueOutcome(issue) === 'not-found') {
    return 'declaredMissing';
  }
  if (issueOutcome(issue) === 'not-expected') {
    const granularity = classifyDiffSubjectGranularity(issue, granularityOf);
    if (granularity === 'entity' || granularity === 'namespace') {
      return 'extraTopLevelObject';
    }
    if (granularity === 'field') {
      return 'extraNestedElement';
    }
    return 'extraAuxiliary';
  }
  return 'declaredIncompatible';
}

/**
 * Whether a `not-expected` issue is a strict-mode-only finding. The legacy
 * walk detected every relational extra (namespaces, entities, fields, and
 * their auxiliaries) only under `--strict`; the structural diff (roots, RLS
 * policies, roles) was never strict-gated — its extras fail in both modes.
 * Keyed on the issue's granularity, resolved via `granularityOf`.
 */
function isStrictOnlyExtra(
  issue: SchemaDiffIssue,
  granularityOf: (nodeKind: string) => DiffSubjectGranularity,
): boolean {
  const granularity = classifyDiffSubjectGranularity(issue, granularityOf);
  return (
    granularity === 'namespace' ||
    granularity === 'entity' ||
    granularity === 'field' ||
    granularity === 'auxiliary'
  );
}

// ============================================================================
// The post-diff filter + verdict
// ============================================================================

export interface SqlDiffVerdictInput {
  /** The full, ownership-scoped diff issue list from the target's differ. */
  readonly issues: readonly SchemaDiffIssue[];
  /** Resolves a diff issue's subject table's declared control policy directly from the contract. */
  readonly resolveControlPolicy: (issue: SchemaDiffIssue) => ControlPolicy | undefined;
  readonly strict: boolean;
  readonly defaultControlPolicy: ControlPolicy | undefined;
  /** The target's classifier: a diff issue node's `nodeKind` → its subject granularity. */
  readonly granularityOf: (nodeKind: string) => DiffSubjectGranularity;
}

export interface SqlDiffVerdict {
  readonly failures: readonly SchemaDiffIssue[];
  readonly warnings: readonly SchemaDiffIssue[];
}

/**
 * Applies the two consumer filters to a diff issue list: strict gating
 * (relational `not-expected` findings drop in lenient mode) and
 * control-policy disposition (each surviving issue grades against its
 * subject table's effective policy; suppressed issues drop, `observed`
 * subjects warn). The verify verdict is `failures.length === 0`.
 */
export function computeSqlDiffVerdict(input: SqlDiffVerdictInput): SqlDiffVerdict {
  const failures: SchemaDiffIssue[] = [];
  const warnings: SchemaDiffIssue[] = [];
  for (const issue of input.issues) {
    if (
      !input.strict &&
      issueOutcome(issue) === 'not-expected' &&
      isStrictOnlyExtra(issue, input.granularityOf)
    ) {
      continue;
    }
    const tablePolicy = input.resolveControlPolicy(issue);
    const policy = effectiveControlPolicy(tablePolicy, input.defaultControlPolicy);
    const disposition: VerifierOutcome = dispositionForCategory(
      policy,
      classifySqlDiffIssue(issue, input.granularityOf),
    );
    if (disposition === 'suppress') continue;
    if (disposition === 'warn') {
      warnings.push(issue);
      continue;
    }
    failures.push(issue);
  }
  return { failures, warnings };
}

// ============================================================================
// Storage-types check — the codec verifyType hook path
// ============================================================================

export interface StorageTypeVerdictInput {
  readonly contract: Contract<SqlStorage>;
  /**
   * Expected/actual namespace-node pairs the target's differ input produced:
   * for a namespaced tree, one entry per expected namespace with a
   * non-empty table set, paired by DDL schema name (absent actual side for
   * a schema the database lacks); a flat tree is the sole pair.
   */
  readonly namespacePairs: ReadonlyArray<{
    readonly actual: SqlSchemaIRNode | undefined;
  }>;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
}

/**
 * Runs the codec `verifyType` hooks the way the legacy walk did: once per
 * contract namespace with tables, against that namespace's paired actual
 * node (the hook reads namespace-scoped state such as `enums` off it).
 * Issue dispositions grade against the contract default policy, matching
 * the legacy `pushTypeNode` semantics.
 */
export interface StorageTypeVerdict {
  readonly failures: readonly SchemaDiffIssue[];
  readonly warnings: readonly SchemaDiffIssue[];
}

export function computeStorageTypeVerdict(input: StorageTypeVerdictInput): StorageTypeVerdict {
  const failures: SchemaDiffIssue[] = [];
  const warnings: SchemaDiffIssue[] = [];
  const policy = effectiveControlPolicy(undefined, input.contract.defaultControlPolicy);
  for (const pair of input.namespacePairs) {
    if (pair.actual === undefined) continue;
    for (const [typeName, typeInstance] of Object.entries(input.contract.storage.types ?? {})) {
      if (!isStorageTypeInstance(typeInstance)) continue;
      const hook = input.codecHooks.get(typeInstance.codecId);
      if (!hook?.verifyType) continue;
      const typeIssues = hook.verifyType({ typeName, typeInstance, schema: pair.actual });
      for (const issue of typeIssues) {
        const disposition = verifierDisposition(policy, issue);
        if (disposition === 'suppress') continue;
        if (disposition === 'warn') {
          warnings.push(issue);
          continue;
        }
        failures.push(issue);
      }
    }
  }
  return { failures, warnings };
}

// ============================================================================
// The issue-based verify envelope
// ============================================================================

export interface VerifySqlSchemaByDiffInput {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly strict: boolean;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  /** The target's full-tree node diff (`diffSchema` descriptor hook). */
  readonly diffSchema: SqlSchemaDiffFn;
  /** The target's classifier: a diff issue node's `nodeKind` → its subject granularity. */
  readonly granularityOf: (nodeKind: string) => DiffSubjectGranularity;
}

/**
 * THE SQL schema verify: runs the target's full-tree node diff, grades it
 * through the family's post-diff filters (strict gating + control-policy
 * disposition) plus the codec `verifyType` hook findings, and wraps the
 * verdict in the issue-based result envelope. `ok` holds exactly when both
 * issue lists are empty — the lists carry the verdict's failures.
 */
export function verifySqlSchemaByDiff(
  input: VerifySqlSchemaByDiffInput,
): VerifyDatabaseSchemaResult {
  const startTime = Date.now();
  const verdictDiff = input.diffSchema({
    contract: input.contract,
    schema: input.schema,
    frameworkComponents: input.frameworkComponents,
  });
  const diffVerdict = computeSqlDiffVerdict({
    issues: verdictDiff.issues,
    resolveControlPolicy: verdictDiff.resolveControlPolicy,
    strict: input.strict,
    defaultControlPolicy: input.contract.defaultControlPolicy,
    granularityOf: input.granularityOf,
  });
  const storageTypeVerdict = computeStorageTypeVerdict({
    contract: input.contract,
    namespacePairs: verdictDiff.namespacePairs,
    codecHooks: extractCodecControlHooks(input.frameworkComponents),
  });
  const failCount = diffVerdict.failures.length + storageTypeVerdict.failures.length;
  const ok = failCount === 0;
  const profileHash =
    'profileHash' in input.contract && typeof input.contract.profileHash === 'string'
      ? input.contract.profileHash
      : undefined;
  return {
    ok,
    ...(ok ? {} : { code: VERIFY_CODE_SCHEMA_FAILURE }),
    summary: ok
      ? 'Database schema satisfies contract'
      : `Database schema does not satisfy contract (${failCount} failure${failCount === 1 ? '' : 's'})`,
    contract: {
      storageHash: input.contract.storage.storageHash,
      ...ifDefined('profileHash', profileHash),
    },
    target: {
      expected: input.contract.target,
      actual: input.contract.target,
    },
    schema: {
      issues: [...diffVerdict.failures, ...storageTypeVerdict.failures],
      warnings: {
        issues: [...diffVerdict.warnings, ...storageTypeVerdict.warnings],
      },
    },
    meta: { strict: input.strict },
    timings: { total: Date.now() - startTime },
  };
}
