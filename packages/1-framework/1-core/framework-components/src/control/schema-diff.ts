import { InternalError } from '@internal/utils/internal-error';

/**
 * A root-anchored chain of `(nodeKind, id)` steps identifying a node in a
 * schema tree — the same vocabulary the differ pairs siblings with. Used by
 * `DiffableNode.dependsOn` to name a node's structural prerequisites without
 * holding a reference to the node itself (the target may live on the other
 * diff side, or not exist at all).
 */
export type SchemaNodeRef = readonly { readonly nodeKind: string; readonly id: string }[];

export interface SchemaDiffIssue<TNode extends DiffableNode = DiffableNode> {
  /** Path from the root node down to the diffed node, as a sequence of local keys. */
  readonly path: readonly string[];
  /** The expected (desired-side) node, when available. Absent for a drop. */
  readonly expected?: TNode;
  /** The actual (current-side) node, when available. Absent for a create. */
  readonly actual?: TNode;
  /**
   * Paths of the other in-diff issues this issue depends on. Mirrored by
   * `diffSchemas` from the node's own `dependsOn` refs: a ref resolves to a
   * path only when some emitted issue sits at that exact path with a
   * matching `nodeKind` — a ref whose target produced no issue is dropped
   * (the dependency is satisfied by reality).
   */
  readonly dependsOn?: readonly (readonly string[])[];
}

/**
 * The three ways an actual state can fail an expectation: it lacks a node that
 * was expected (`not-found`), holds a node that was not expected
 * (`not-expected`), or holds a node not equal to the expected one
 * (`not-equal`). Expected is the desired side, actual the current side, of
 * whatever comparison produced the issue (contract-vs-database, or
 * contract-vs-contract in an offline plan), so the vocabulary is
 * comparison-relative and never ambiguous about a base — and reads cleanly for
 * both the planner and `db verify`.
 *
 * This is the RETURN TYPE of the derived {@link issueOutcome} helper, not a
 * stored field: presence is the single source of truth, and the outcome is
 * computed from it on demand.
 */
export type ExpectationFailureReason = 'not-found' | 'not-expected' | 'not-equal';

/**
 * The outcome an issue represents, discriminated by presence rather than any
 * stored field — the single source of truth every consumer reads. An issue
 * always carries at least one side by construction; neither is a malformed
 * issue and throws.
 */
export function issueOutcome(issue: SchemaDiffIssue): ExpectationFailureReason {
  const hasExpected = issue.expected !== undefined;
  const hasActual = issue.actual !== undefined;
  if (hasExpected && hasActual) return 'not-equal';
  if (hasExpected) return 'not-found';
  if (hasActual) return 'not-expected';
  throw new InternalError(
    `issueOutcome: issue at "${issue.path.join('/')}" carries neither an expected nor an actual node`,
  );
}

/**
 * A node in the schema tree. Every node in the tree implements this interface.
 *
 * The differ pairs siblings by the combination of `nodeKind` and `id`, not by
 * `id` alone: `id` needs only be unique among siblings of the same
 * `nodeKind` at the same level, not globally unique at that level. Two
 * distinct kinds of child in distinct slots (e.g. a role and a namespace) may
 * legitimately share a name — they are never paired against each other, so
 * the collision is harmless. A node never folds its kind into its id string
 * to route around this; `nodeKind` is the discriminant that does that job.
 * A same-`nodeKind`/same-`id` collision among siblings is a genuine
 * duplicate and is enforced by a throw. The differ accumulates ids (not
 * nodeKind) into a path that stamps every emitted issue.
 */
export interface DiffableNode {
  readonly id: string;
  readonly nodeKind: string;
  /**
   * The nodes this node structurally depends on — resolved references to the
   * prerequisites that must exist before it. Stamped by the derivation that
   * holds the parent context; both the expected and the actual derivation
   * stamp it by the same structural rules. Never compared by `isEqualTo`.
   */
  readonly dependsOn?: readonly SchemaNodeRef[];
  isEqualTo(other: DiffableNode): boolean;
  children(): readonly DiffableNode[];
}

function siblingKey(node: DiffableNode): string {
  return JSON.stringify([node.nodeKind, node.id]);
}

function insertNode(map: Map<string, DiffableNode>, node: DiffableNode): void {
  const key = siblingKey(node);
  if (map.has(key)) {
    throw new InternalError(
      `diffSchemas: duplicate id among siblings: ${node.nodeKind}/${node.id}`,
    );
  }
  map.set(key, node);
}

function emitMissingSubtree(node: DiffableNode, parentPath: readonly string[]): SchemaDiffIssue[] {
  const path = [...parentPath, node.id];
  return [
    {
      path,
      expected: node,
    },
    ...node.children().flatMap((c) => emitMissingSubtree(c, path)),
  ];
}

function emitExtraSubtree(node: DiffableNode, parentPath: readonly string[]): SchemaDiffIssue[] {
  const path = [...parentPath, node.id];
  return [
    {
      path,
      actual: node,
    },
    ...node.children().flatMap((c) => emitExtraSubtree(c, path)),
  ];
}

/**
 * Diff two schema trees starting from their roots.
 *
 * The differ is **total**: every node-level difference is reported. An unmatched
 * non-leaf node emits its own issue and descends, emitting an issue for every
 * node in the missing/extra subtree. Coalescing a parent change over its
 * children is the planner's responsibility. Ownership filtering (dropping `extra`
 * issues in namespaces a contract doesn't own) is the caller's responsibility.
 */
export function diffSchemas(
  expected: DiffableNode,
  actual: DiffableNode,
): readonly SchemaDiffIssue[] {
  return mirrorDependsOnOntoIssues(diffPair(expected, actual, []));
}

function schemaNodeRefKey(ref: SchemaNodeRef): string {
  return JSON.stringify(ref.map((step) => step.id));
}

function issuePathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function terminalNodeKind(issue: SchemaDiffIssue): string | undefined {
  return (issue.expected ?? issue.actual)?.nodeKind;
}

/**
 * Copies each issue's node's `dependsOn` refs onto the issue itself, as
 * issue-to-issue path references. A ref is kept only when some emitted issue
 * sits at that exact path AND that issue's node `nodeKind` matches the ref's
 * last step — otherwise the ref is dropped (its target either didn't
 * change, or was never part of either tree; either way the dependency is
 * satisfied by reality, not by an operation this diff will produce).
 *
 * The path index is a multimap: two siblings may share an `id` under
 * different `nodeKind`s (a role and a namespace named alike), so an id-path
 * alone is ambiguous. The ref's terminal `nodeKind` disambiguates — the ref
 * resolves only against a same-path issue whose own node carries that kind.
 */
function mirrorDependsOnOntoIssues(issues: readonly SchemaDiffIssue[]): readonly SchemaDiffIssue[] {
  const issuesByPath = new Map<string, SchemaDiffIssue[]>();
  for (const issue of issues) {
    const key = issuePathKey(issue.path);
    const bucket = issuesByPath.get(key);
    if (bucket === undefined) issuesByPath.set(key, [issue]);
    else bucket.push(issue);
  }

  return issues.map((issue) => {
    const node = issue.expected ?? issue.actual;
    const refs = node?.dependsOn;
    if (refs === undefined || refs.length === 0) return issue;

    const dependsOn = refs.flatMap((ref) => {
      const lastStep = ref[ref.length - 1];
      if (lastStep === undefined) return [];
      const candidates = issuesByPath.get(schemaNodeRefKey(ref)) ?? [];
      const resolved = candidates.some((c) => terminalNodeKind(c) === lastStep.nodeKind);
      if (!resolved) return [];
      return [ref.map((step) => step.id)];
    });

    if (dependsOn.length === 0) return issue;
    return { ...issue, dependsOn };
  });
}

function diffPair(
  expected: DiffableNode,
  actual: DiffableNode,
  parentPath: readonly string[],
): readonly SchemaDiffIssue[] {
  const path = [...parentPath, expected.id];
  const issues: SchemaDiffIssue[] = [];
  if (!expected.isEqualTo(actual)) {
    issues.push({
      path,
      expected,
      actual,
    });
  }
  issues.push(...diffChildren(expected.children(), actual.children(), path));
  return issues;
}

/**
 * Align one level of nodes by `(nodeKind, id)`; emit issues in input order
 * and recurse.
 *
 * A missing node emits one issue for itself and one for every node in its
 * subtree (total descent). Same for extra nodes. A matched pair recurses via
 * `diffPair`.
 */
function diffChildren(
  expected: readonly DiffableNode[],
  actual: readonly DiffableNode[],
  parentPath: readonly string[],
): readonly SchemaDiffIssue[] {
  const expectedMap = new Map<string, DiffableNode>();
  for (const node of expected) {
    insertNode(expectedMap, node);
  }

  const actualMap = new Map<string, DiffableNode>();
  for (const node of actual) {
    insertNode(actualMap, node);
  }

  const issues: SchemaDiffIssue[] = [];

  for (const [key, expectedNode] of expectedMap) {
    const actualNode = actualMap.get(key);
    if (actualNode === undefined) {
      issues.push(...emitMissingSubtree(expectedNode, parentPath));
    } else {
      issues.push(...diffPair(expectedNode, actualNode, parentPath));
    }
  }

  for (const [key, actualNode] of actualMap) {
    if (!expectedMap.has(key)) {
      issues.push(...emitExtraSubtree(actualNode, parentPath));
    }
  }

  return issues;
}

/**
 * The result of diffing a contract's expected schema against the introspected
 * actual schema: one node-typed issue list. Carries no verdict, verification
 * tree, or counts — those are the verifier's own presentation, built from the
 * same underlying comparison.
 *
 * `TNode` is the concrete schema-IR node the issues carry; it defaults to
 * `DiffableNode`, so this is purely additive — a caller that wants the
 * concrete node opts in (the Postgres planner uses the concrete node type),
 * everyone else keeps the default unchanged.
 */
export class SchemaDiff<TNode extends DiffableNode = DiffableNode> {
  readonly issues: readonly SchemaDiffIssue<TNode>[];

  constructor(issues: readonly SchemaDiffIssue<TNode>[]) {
    this.issues = issues;
  }

  /** Returns a new `SchemaDiff` narrowed to the issues `keep` returns true for. */
  filter(keep: (issue: SchemaDiffIssue<TNode>) => boolean): SchemaDiff<TNode> {
    return new SchemaDiff(this.issues.filter(keep));
  }
}
