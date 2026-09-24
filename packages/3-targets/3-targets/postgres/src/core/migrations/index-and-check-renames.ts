import type { SqlMigrationPlannerPlanOptions } from '@internal/family-sql/control';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { parseWireName } from '@internal/sql-schema-ir/naming';
import { SqlCheckConstraintIR, SqlIndexIR } from '@internal/sql-schema-ir/types';
import type { SqlSchemaDiffNode } from '../schema-ir/schema-node-kinds';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import { issueNode } from './issue-planner';
import { RenameConstraintCall, RenameIndexCall } from './op-factory-call';

/**
 * Rename post-pass for indexes, per `(schema, table)`, widening-only,
 * deterministic by sorted names — the same structure as the policy pass
 * below (which stays untouched: policies pair by hash only).
 *
 * Hash pairing (prefix-only renames): extras whose live names parse as
 * wire names, grouped by `(schema, table, hash)`; missing nodes iterated
 * in sorted-name order consume the sorted-name-first candidate.
 *
 * Content pairing (exact→wire convergence), after hash pairing has
 * consumed its matches: the remaining wire-named-missing nodes
 * (`prefix` defined) against the remaining extras of any name shape,
 * paired iff content-equal (columns ordered-strict both-defined-or-
 * both-undefined, `unique`/`type` strict, `options` loose, bodies
 * byte-equal).
 *
 * Leftovers proceed as create/drop exactly as before; without the
 * widening allowance the pass is skipped and pairing degrades to the
 * additive half, like the policy pass.
 */
export function pairIndexRenames(
  options: Pick<SqlMigrationPlannerPlanOptions, 'contract' | 'policy'>,
  issues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
): {
  readonly calls: readonly RenameIndexCall[];
  readonly consumed: ReadonlySet<SchemaDiffIssue<SqlSchemaDiffNode>>;
} {
  const consumed = new Set<SchemaDiffIssue<SqlSchemaDiffNode>>();
  const calls: RenameIndexCall[] = [];
  if (!options.policy.allowedOperationClasses.includes('widening')) {
    return { calls, consumed };
  }

  interface IndexFinding {
    readonly issue: SchemaDiffIssue<SqlSchemaDiffNode>;
    readonly node: SqlIndexIR;
    readonly ddlSchema: string;
    readonly tableName: string;
  }
  const missing: IndexFinding[] = [];
  const extra: IndexFinding[] = [];
  for (const issue of issues) {
    const node = issueNode(issue);
    if (node === undefined || !SqlIndexIR.is(node)) continue;
    const ddlSchema = issue.path[1];
    const tableName = issue.path[2];
    if (ddlSchema === undefined || tableName === undefined) continue;
    if (issueOutcome(issue) === 'not-found') {
      missing.push({ issue, node, ddlSchema, tableName });
    } else if (issueOutcome(issue) === 'not-expected') {
      extra.push({ issue, node, ddlSchema, tableName });
    }
  }
  if (missing.length === 0 || extra.length === 0) {
    return { calls, consumed };
  }

  const byName = (a: IndexFinding, b: IndexFinding): number =>
    a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0;
  // DDL emission must stay unqualified for the unbound namespace, exactly
  // like the per-issue mapping's `emissionSchemaName`.
  const emissionSchema = (ddlSchema: string): string =>
    resolveNamespaceIdForDdlSchema(options.contract, ddlSchema) === UNBOUND_NAMESPACE_ID
      ? UNBOUND_NAMESPACE_ID
      : ddlSchema;
  const pairingKey = (finding: IndexFinding, hash: string): string =>
    JSON.stringify([finding.ddlSchema, finding.tableName, hash]);
  const rename = (missingFinding: IndexFinding, candidate: IndexFinding): void => {
    consumed.add(missingFinding.issue);
    consumed.add(candidate.issue);
    calls.push(
      new RenameIndexCall(
        emissionSchema(missingFinding.ddlSchema),
        missingFinding.tableName,
        candidate.node.name,
        missingFinding.node.name,
      ),
    );
  };

  const sortedMissing = [...missing].sort(byName);

  const extrasByHash = new Map<string, IndexFinding[]>();
  for (const finding of extra) {
    const parsed = parseWireName(finding.node.name);
    if (parsed === undefined) continue;
    const key = pairingKey(finding, parsed.hash);
    const group = extrasByHash.get(key) ?? [];
    group.push(finding);
    extrasByHash.set(key, group);
  }
  for (const group of extrasByHash.values()) {
    group.sort(byName);
  }
  for (const missingFinding of sortedMissing) {
    const parsed = parseWireName(missingFinding.node.name);
    if (parsed === undefined) continue;
    const candidate = extrasByHash.get(pairingKey(missingFinding, parsed.hash))?.shift();
    if (candidate === undefined) continue;
    rename(missingFinding, candidate);
  }

  const sortedExtras = [...extra].sort(byName);
  for (const missingFinding of sortedMissing) {
    if (consumed.has(missingFinding.issue)) continue;
    if (missingFinding.node.prefix === undefined) continue;
    const candidate = sortedExtras.find(
      (extraFinding) =>
        !consumed.has(extraFinding.issue) &&
        extraFinding.ddlSchema === missingFinding.ddlSchema &&
        extraFinding.tableName === missingFinding.tableName &&
        missingFinding.node.contentEquals(extraFinding.node, {
          columnPresence: 'matching',
          bodies: 'verbatim',
        }),
    );
    if (candidate === undefined) continue;
    rename(missingFinding, candidate);
  }

  return { calls, consumed };
}

/**
 * Check-constraint rename post-pass: a `not-found` and a `not-expected`
 * check on the same table whose wire-name content hashes match but whose
 * prefixes differ is a prefix-only rename, and collapses into one
 * `ALTER TABLE … RENAME CONSTRAINT`.
 *
 * This is the index pass's hash-pairing phase and nothing else. There is
 * deliberately no content-pairing phase: a live check body is whatever
 * Postgres reprinted, so it never byte-matches the authored text, and
 * pairing an exact-named live check by content would bless whatever
 * predicate is actually live. Adoption of an old exact-named check stays
 * drop + add.
 *
 * Runs only when the policy allows `widening` (rename's class). Without it
 * the pass no-ops and the pair degrades to the slice-1 behavior: an add,
 * plus a drop when `destructive` is allowed too.
 */
export function pairCheckRenames(
  options: Pick<SqlMigrationPlannerPlanOptions, 'contract' | 'policy'>,
  issues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
): {
  readonly calls: readonly RenameConstraintCall[];
  readonly consumed: ReadonlySet<SchemaDiffIssue<SqlSchemaDiffNode>>;
} {
  const consumed = new Set<SchemaDiffIssue<SqlSchemaDiffNode>>();
  const calls: RenameConstraintCall[] = [];
  if (!options.policy.allowedOperationClasses.includes('widening')) {
    return { calls, consumed };
  }

  interface CheckFinding {
    readonly issue: SchemaDiffIssue<SqlSchemaDiffNode>;
    readonly node: SqlCheckConstraintIR;
    readonly ddlSchema: string;
    readonly tableName: string;
  }
  const missing: CheckFinding[] = [];
  const extra: CheckFinding[] = [];
  for (const issue of issues) {
    const node = issueNode(issue);
    if (node === undefined || !SqlCheckConstraintIR.is(node)) continue;
    const ddlSchema = issue.path[1];
    const tableName = issue.path[2];
    if (ddlSchema === undefined || tableName === undefined) continue;
    if (issueOutcome(issue) === 'not-found') {
      missing.push({ issue, node, ddlSchema, tableName });
    } else if (issueOutcome(issue) === 'not-expected') {
      extra.push({ issue, node, ddlSchema, tableName });
    }
  }
  if (missing.length === 0 || extra.length === 0) {
    return { calls, consumed };
  }

  const byName = (a: CheckFinding, b: CheckFinding): number =>
    a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0;
  // DDL emission must stay unqualified for the unbound namespace, exactly
  // like the per-issue mapping's `emissionSchemaName`.
  const emissionSchema = (ddlSchema: string): string =>
    resolveNamespaceIdForDdlSchema(options.contract, ddlSchema) === UNBOUND_NAMESPACE_ID
      ? UNBOUND_NAMESPACE_ID
      : ddlSchema;
  const pairingKey = (finding: CheckFinding, hash: string): string =>
    JSON.stringify([finding.ddlSchema, finding.tableName, hash]);

  const sortedMissing = [...missing].sort(byName);

  const extrasByHash = new Map<string, CheckFinding[]>();
  for (const finding of extra) {
    const parsed = parseWireName(finding.node.name);
    if (parsed === undefined) continue;
    const key = pairingKey(finding, parsed.hash);
    const group = extrasByHash.get(key) ?? [];
    group.push(finding);
    extrasByHash.set(key, group);
  }
  for (const group of extrasByHash.values()) {
    group.sort(byName);
  }
  for (const missingFinding of sortedMissing) {
    const parsed = parseWireName(missingFinding.node.name);
    if (parsed === undefined) continue;
    const candidate = extrasByHash.get(pairingKey(missingFinding, parsed.hash))?.shift();
    if (candidate === undefined) continue;
    consumed.add(missingFinding.issue);
    consumed.add(candidate.issue);
    calls.push(
      new RenameConstraintCall(
        emissionSchema(missingFinding.ddlSchema),
        missingFinding.tableName,
        'checkConstraint',
        candidate.node.name,
        missingFinding.node.name,
      ),
    );
  }

  return { calls, consumed };
}
