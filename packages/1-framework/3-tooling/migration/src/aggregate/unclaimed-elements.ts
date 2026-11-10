import type {
  DiffSubjectGranularity,
  SchemaDiffIssue,
  SchemaEntityCoordinate,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { issueOutcome, VERIFY_CODE_SCHEMA_FAILURE } from '@internal/framework-components/control';
import { coordinateKey, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';

/**
 * Classifies a diff issue's subject granularity on demand — the injected
 * capability a contract space's family/target instance provides (via
 * `hasSchemaSubjectClassifier`). This module never imports family node
 * classes and never reads a classification off the node or the issue;
 * absent entirely for families that classify nothing.
 */
export type SchemaSubjectClassifier = (
  issue: SchemaDiffIssue,
) => DiffSubjectGranularity | undefined;

/**
 * Classifies a diff issue's subject storage `entityKind` on demand — the
 * sibling injected capability (`hasSchemaSubjectClassifier`'s
 * `classifyEntityKind`) that resolves the same per-family vocabulary the
 * contract storage's `entries` dictionary uses. This module never hardcodes
 * a family entity kind; absent for families that classify nothing.
 */
export type SchemaEntityKindClassifier = (issue: SchemaDiffIssue) => string | undefined;

/**
 * Placeholder `entityKind` for a whole-entity issue detected via the
 * classifier-absent path-shape fallback (no family/target injects a
 * classifier — e.g. a document family). Not a real family vocabulary term:
 * no ownership consumer queries `declaresEntity` for a family in this state
 * today.
 */
export const UNCLASSIFIED_ENTITY_KIND = 'unclassified-entity';

function pathIsUnder(path: readonly string[], prefix: readonly string[]): boolean {
  if (path.length < prefix.length) return false;
  return prefix.every((segment, i) => path[i] === segment);
}

/**
 * Whether an issue's subject is a WHOLE top-level entity — as opposed to
 * something nested under one (e.g. a field, an index, or a policy). Calls
 * the injected `classify` capability, which resolves this from the issue's
 * node `nodeKind` (this aggregate never reaches into the node itself).
 * Absent `classify` (or a `classify` that returns nothing for this issue —
 * a family that doesn't classify) falls back to path shape: a
 * top-level entity's path is exactly its own name (one segment), so
 * anything deeper is nested.
 */
function isWholeEntityIssue(issue: SchemaDiffIssue, classify?: SchemaSubjectClassifier): boolean {
  const granularity = classify?.(issue);
  if (granularity !== undefined) return granularity === 'entity';
  return issue.path.length === 1;
}

/**
 * A contract space's contract-satisfaction view. Strips the top-level entity
 * extras — the `not-expected` findings on whole-entity nodes (plus the
 * findings the differ's total descent reported under those entities). Those
 * belong to the standalone unclaimed-elements list
 * ({@link collectExtraElementCoordinates}), never a space's own verdict.
 *
 * Nested `not-expected` findings (an extra field on the space's own
 * declared entity…) and structural findings (an undeclared policy) are
 * the space's **own drift** and stay.
 *
 * The verdict recomputes from the surviving list: the per-space result is
 * issue-based (`ok` ⇔ the list is empty), so a space whose only failures
 * were top-level extras passes after the strip.
 */
export function stripExtraFindings(
  result: VerifyDatabaseSchemaResult,
  classify?: SchemaSubjectClassifier,
): VerifyDatabaseSchemaResult {
  const droppedTablePaths = result.schema.issues
    .filter(
      (issue) => issueOutcome(issue) === 'not-expected' && isWholeEntityIssue(issue, classify),
    )
    .map((issue) => issue.path);
  const issues = result.schema.issues.filter((issue) => {
    if (issueOutcome(issue) !== 'not-expected') return true;
    if (classify?.(issue) === 'structural') return true;
    return !droppedTablePaths.some((prefix) => pathIsUnder(issue.path, prefix));
  });

  if (issues.length === result.schema.issues.length) return result;

  const ok = issues.length === 0;
  const { code: staleCode, ...envelope } = result;
  void staleCode;
  // Warnings are the space's own drift-watch (an observed-policy subject), never
  // a sibling's unclaimed extra, so the strip carries them through untouched.
  return {
    ...envelope,
    ok,
    ...(ok ? {} : { code: result.code ?? VERIFY_CODE_SCHEMA_FAILURE }),
    summary: ok ? 'Database schema satisfies contract' : result.summary,
    schema: {
      issues,
      ...(result.schema.warnings !== undefined ? { warnings: result.schema.warnings } : {}),
    },
  };
}

/**
 * The schema-IR entity coordinate a `not-expected` `SchemaDiffIssue`
 * addresses, when its subject is a whole top-level entity. A nested leaf
 * (a field, an index, a policy on an undeclared entity) has no entity of
 * its own to report here.
 *
 * The whole-entity's name is the last path segment: the differ builds each
 * path from its nodes' ids, so at a whole-entity finding the last segment is
 * exactly the entity name — for every family, whether or not it stamps a
 * granularity. The namespace segment only exists for namespace-qualified
 * paths (`['database', namespaceId, entityName]`); single-namespace families
 * (a flat `['database', entityName]`, or a bare `[entityName]`) have no
 * separate segment, so every entity they declare implicitly shares one
 * namespace — the same sentinel the aggregate's own coordinate walk uses
 * for those families.
 *
 * `entityKind` is asked from the injected `classifyEntityKind` capability —
 * this module never names a family entity kind itself. Absent a classifier
 * (the classifier-absent path-shape fallback, e.g. a document family) the
 * coordinate carries {@link UNCLASSIFIED_ENTITY_KIND}: no ownership
 * consumer queries `declaresEntity` for a family in that state today, so
 * nothing reads the value as true.
 */
function schemaDiffIssueCoordinate(
  issue: SchemaDiffIssue,
  classify?: SchemaSubjectClassifier,
  classifyEntityKind?: SchemaEntityKindClassifier,
): SchemaEntityCoordinate | undefined {
  if (!isWholeEntityIssue(issue, classify)) return undefined;
  const entityName = issue.path[issue.path.length - 1];
  if (entityName === undefined) return undefined;
  const namespaceId =
    issue.path.length === 3 ? (issue.path[1] ?? UNBOUND_NAMESPACE_ID) : UNBOUND_NAMESPACE_ID;
  const entityKind = classifyEntityKind?.(issue) ?? UNCLASSIFIED_ENTITY_KIND;
  return { namespaceId, entityKind, entityName };
}

/**
 * The schema-IR entity coordinates of every live element this contract
 * space's diff reports as `not-expected`, deduplicated. The verifier gathers
 * these across all spaces and keeps only the coordinates no contract space
 * declares — the standalone unclaimed-elements list, reported once for the
 * whole database.
 */
export function collectExtraElementCoordinates(
  result: VerifyDatabaseSchemaResult,
  classify?: SchemaSubjectClassifier,
  classifyEntityKind?: SchemaEntityKindClassifier,
): readonly SchemaEntityCoordinate[] {
  const seen = new Map<string, SchemaEntityCoordinate>();
  for (const issue of result.schema.issues) {
    if (issueOutcome(issue) !== 'not-expected') continue;
    const coordinate = schemaDiffIssueCoordinate(issue, classify, classifyEntityKind);
    if (coordinate === undefined) continue;
    seen.set(coordinateKey(coordinate), coordinate);
  }
  return [...seen.values()];
}
