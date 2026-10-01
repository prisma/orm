import { ifDefined } from '@internal/utils/defined';
import { EMPTY_CONTRACT_HASH } from './constants';
import type { MigrationEdge, MigrationGraph } from './graph';
import { bfs } from './graph-ops';
import type { OnDiskMigrationPackage } from './package';

/** Forward-edge neighbours: edge `e` from `n` visits `e.to` next. */
function forwardNeighbours(graph: MigrationGraph, node: string) {
  return (graph.forwardChain.get(node) ?? []).map((edge) => ({ next: edge.to, edge }));
}

/**
 * Forward-edge neighbours, sorted by the deterministic tie-break.
 * Used by path-finding so the resulting shortest path is stable across runs.
 */
function sortedForwardNeighbours(graph: MigrationGraph, node: string) {
  const edges = graph.forwardChain.get(node) ?? [];
  return [...edges].sort(compareTieBreak).map((edge) => ({ next: edge.to, edge }));
}

/** Reverse-edge neighbours: edge `e` from `n` visits `e.from` next. */
function reverseNeighbours(graph: MigrationGraph, node: string) {
  return (graph.reverseChain.get(node) ?? []).map((edge) => ({ next: edge.from, edge }));
}

function appendEdge(map: Map<string, MigrationEdge[]>, key: string, entry: MigrationEdge): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
}

export function reconstructGraph(packages: readonly OnDiskMigrationPackage[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationEdge[]>();
  const reverseChain = new Map<string, MigrationEdge[]>();
  const migrationByHash = new Map<string, MigrationEdge>();

  for (const pkg of packages) {
    // Manifest `from` is `string | null` (null = baseline). The graph layer
    // is the marker/path layer where "no prior state" is encoded as the
    // EMPTY_CONTRACT_HASH sentinel; bridge here so pathfinding stays string-
    // keyed.
    const from = pkg.metadata.from ?? EMPTY_CONTRACT_HASH;
    const { to } = pkg.metadata;

    nodes.add(from);
    nodes.add(to);

    const migration: MigrationEdge = {
      from,
      to,
      migrationHash: pkg.metadata.migrationHash,
      dirName: pkg.dirName,
      createdAt: pkg.metadata.createdAt,
      invariants: pkg.metadata.providedInvariants,
    };

    if (!migrationByHash.has(migration.migrationHash)) {
      migrationByHash.set(migration.migrationHash, migration);
    }

    appendEdge(forwardChain, from, migration);
    appendEdge(reverseChain, to, migration);
  }

  return { nodes, forwardChain, reverseChain, migrationByHash };
}

// ---------------------------------------------------------------------------
// Deterministic tie-breaking for BFS neighbour order.
// Used by path-finders only; not a general-purpose utility.
// Ordering: createdAt → to → migrationHash.
// ---------------------------------------------------------------------------

function compareTieBreak(a: MigrationEdge, b: MigrationEdge): number {
  const ca = a.createdAt.localeCompare(b.createdAt);
  if (ca !== 0) return ca;
  const tc = a.to.localeCompare(b.to);
  if (tc !== 0) return tc;
  return a.migrationHash.localeCompare(b.migrationHash);
}

function sortedNeighbors(edges: readonly MigrationEdge[]): readonly MigrationEdge[] {
  return [...edges].sort(compareTieBreak);
}

/**
 * Find the shortest path from `fromHash` to `toHash` using BFS over the
 * contract-hash graph. Returns the ordered list of edges, or null if no path
 * exists. Returns an empty array when `fromHash === toHash` (no-op).
 *
 * Neighbor ordering is deterministic via the tie-break sort key:
 * createdAt → to → migrationHash.
 */
export function findPath(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
): readonly MigrationEdge[] | null {
  if (fromHash === toHash) return [];

  const parents = new Map<string, { parent: string; edge: MigrationEdge }>();
  for (const step of bfs([fromHash], (n) => sortedForwardNeighbours(graph, n))) {
    if (step.parent !== null && step.incomingEdge !== null) {
      parents.set(step.state, { parent: step.parent, edge: step.incomingEdge });
    }
    if (step.state === toHash) {
      const path: MigrationEdge[] = [];
      let cur = toHash;
      let p = parents.get(cur);
      while (p) {
        path.push(p.edge);
        cur = p.parent;
        p = parents.get(cur);
      }
      path.reverse();
      return path;
    }
  }

  return null;
}

/**
 * Find the shortest path from `fromHash` to `toHash` whose edges collectively
 * cover every invariant in `required`. Returns `null` when no such path exists
 * (either `fromHash`→`toHash` is structurally unreachable, or every reachable
 * path leaves at least one required invariant uncovered). When `required` is
 * empty, delegates to `findPath` so the result is byte-identical for that case.
 *
 * Algorithm: BFS over `(node, coveredSubset)` states with state-level dedup.
 * The covered subset is a `Set<string>` of invariant ids; the state's dedup
 * key is the JSON encoding of `[node, sortedCoveredIds]`, which distinguishes
 * distinct `(node, covered)` tuples for any node name or invariant id.
 *
 * Neighbour ordering when `required ≠ ∅`: edges covering ≥1 still-needed
 * invariant come first, with `createdAt → to → migrationHash` as the
 * secondary key. The heuristic steers BFS toward the satisfying path;
 * correctness (shortest, deterministic) does not depend on it.
 */
export function findPathWithInvariants(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
  required: ReadonlySet<string>,
): readonly MigrationEdge[] | null {
  if (required.size === 0) {
    return findPath(graph, fromHash, toHash);
  }

  interface InvState {
    readonly node: string;
    readonly covered: ReadonlySet<string>;
  }
  const stateKey = (s: InvState): string => JSON.stringify([s.node, [...s.covered].sort()]);

  const neighbours = (s: InvState): Iterable<{ next: InvState; edge: MigrationEdge }> => {
    const outgoing = graph.forwardChain.get(s.node) ?? [];
    if (outgoing.length === 0) return [];
    return [...outgoing]
      .map((edge) => {
        let useful = false;
        let next: Set<string> | null = null;
        for (const inv of edge.invariants) {
          if (required.has(inv) && !s.covered.has(inv)) {
            if (next === null) next = new Set(s.covered);
            next.add(inv);
            useful = true;
          }
        }
        return { edge, useful, nextCovered: next ?? s.covered };
      })
      .sort((a, b) => {
        if (a.useful !== b.useful) return a.useful ? -1 : 1;
        return compareTieBreak(a.edge, b.edge);
      })
      .map(({ edge, nextCovered }) => ({
        next: { node: edge.to, covered: nextCovered },
        edge,
      }));
  };

  // Path reconstruction is consumer-side, keyed on stateKey, same shape as
  // findPath's parents map.
  const parents = new Map<string, { parentKey: string; edge: MigrationEdge }>();
  for (const step of bfs<InvState, MigrationEdge>(
    [{ node: fromHash, covered: new Set() }],
    neighbours,
    stateKey,
  )) {
    const curKey = stateKey(step.state);
    if (step.parent !== null && step.incomingEdge !== null) {
      parents.set(curKey, { parentKey: stateKey(step.parent), edge: step.incomingEdge });
    }
    if (step.state.node === toHash && step.state.covered.size === required.size) {
      const path: MigrationEdge[] = [];
      let cur: string | undefined = curKey;
      while (cur !== undefined) {
        const p = parents.get(cur);
        if (!p) break;
        path.push(p.edge);
        cur = p.parentKey;
      }
      path.reverse();
      return path;
    }
  }

  return null;
}

/**
 * Reverse-BFS from `toHash` over `reverseChain` to collect every node from
 * which `toHash` is reachable (inclusive of `toHash` itself).
 */
function collectNodesReachingTarget(graph: MigrationGraph, toHash: string): Set<string> {
  const reached = new Set<string>();
  for (const step of bfs([toHash], (n) => reverseNeighbours(graph, n))) {
    reached.add(step.state);
  }
  return reached;
}

export interface PathDecision {
  readonly selectedPath: readonly MigrationEdge[];
  readonly fromHash: string;
  readonly toHash: string;
  readonly alternativeCount: number;
  readonly tieBreakReasons: readonly string[];
  readonly refName?: string;
  /** The caller-supplied required invariant set, sorted ascending. */
  readonly requiredInvariants: readonly string[];
  /**
   * The subset of `requiredInvariants` actually covered by edges on
   * `selectedPath`. Always a subset of `requiredInvariants` (when the path
   * is satisfying, equal to it); always derived from `selectedPath`.
   */
  readonly satisfiedInvariants: readonly string[];
}

/**
 * Outcome of {@link findPathWithDecision}. The pathfinder distinguishes
 * three cases up front so callers don't re-derive structural reachability:
 *
 * - `ok` — a path covering `required` exists; `decision` carries the
 *   selection metadata and per-edge invariants.
 * - `unreachable` — `from`→`to` has no structural path. Mapped by callers
 *   to the no-path diagnostic (`MIGRATION.PATH_UNREACHABLE`).
 * - `unsatisfiable` — `from`→`to` is structurally reachable but no path
 *   covers every required invariant. `structuralPath` is the
 *   `findPath(graph, from, to)` result, included so callers don't have to
 *   recompute it when raising `MIGRATION.NO_INVARIANT_PATH`. `missing` is
 *   the subset of `required` that the structural path does *not* cover —
 *   correctly accounts for partial coverage when some required invariants
 *   are met by the fallback path. Only emitted when `required` is
 *   non-empty.
 */
export type FindPathOutcome =
  | { readonly kind: 'ok'; readonly decision: PathDecision }
  | { readonly kind: 'unreachable' }
  | {
      readonly kind: 'unsatisfiable';
      readonly structuralPath: readonly MigrationEdge[];
      readonly missing: readonly string[];
    };

/**
 * Routing context for {@link findPathWithDecision}. Both fields are optional;
 * `refName` is only used to decorate the resulting `PathDecision` for the
 * JSON envelope, and `required` defaults to an empty set (purely structural
 * routing). They are passed via a single options object so the call sites
 * cannot silently swap two adjacent string parameters.
 */
export interface FindPathWithDecisionOptions {
  readonly refName?: string;
  readonly required?: ReadonlySet<string>;
}

/**
 * Find the shortest path from `fromHash` to `toHash` and return structured
 * path-decision metadata for machine-readable output. When `required` is
 * non-empty, the returned path is the shortest one whose edges collectively
 * cover every required invariant.
 *
 * The discriminated return type tells the caller *why* a path could not be
 * found, so the CLI can pick the right structured error without re-running
 * a structural BFS.
 */
export function findPathWithDecision(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
  options: FindPathWithDecisionOptions = {},
): FindPathOutcome {
  const { refName, required = new Set<string>() } = options;
  const requiredInvariants = [...required].sort();

  if (fromHash === toHash && required.size === 0) {
    return {
      kind: 'ok',
      decision: {
        selectedPath: [],
        fromHash,
        toHash,
        alternativeCount: 0,
        tieBreakReasons: [],
        requiredInvariants,
        satisfiedInvariants: [],
        ...ifDefined('refName', refName),
      },
    };
  }

  const path = findPathWithInvariants(graph, fromHash, toHash, required);
  if (!path) {
    if (required.size === 0) {
      return { kind: 'unreachable' };
    }
    const structural = findPath(graph, fromHash, toHash);
    if (structural === null) {
      return { kind: 'unreachable' };
    }
    const coveredByStructural = new Set<string>();
    for (const edge of structural) {
      for (const inv of edge.invariants) {
        if (required.has(inv)) coveredByStructural.add(inv);
      }
    }
    const missing = requiredInvariants.filter((id) => !coveredByStructural.has(id));
    return { kind: 'unsatisfiable', structuralPath: structural, missing };
  }

  const satisfiedInvariants = computeSatisfiedInvariants(required, path);

  // Single reverse BFS marks every node from which `toHash` is reachable.
  // Replaces a per-edge `findPath(e.to, toHash)` call inside the loop below,
  // which made the whole function O(|path| · (V + E)) instead of O(V + E).
  const reachesTarget = collectNodesReachingTarget(graph, toHash);
  const coveragePrefixes = requiredCoveragePrefixes(required, path);

  const tieBreakReasons: string[] = [];
  let alternativeCount = 0;

  for (const [i, edge] of path.entries()) {
    const outgoing = graph.forwardChain.get(edge.from);
    if (!outgoing || outgoing.length <= 1) continue;
    const reachable = outgoing.filter((e) => reachesTarget.has(e.to));
    if (reachable.length <= 1) continue;

    let comparisonPool: readonly MigrationEdge[] = reachable;
    if (required.size > 0) {
      // coveragePrefixes is built one-per-edge from path, so the index is
      // always in range here; the explicit guard keeps the type narrowed
      // without a non-null assertion.
      const prefixSet = coveragePrefixes[i];
      if (prefixSet === undefined) continue;
      comparisonPool = invariantViableAlternativesAtStep(required, prefixSet, reachable);
    }

    alternativeCount += reachable.length - 1;
    const sorted = sortedNeighbors(reachable);
    if (sorted[0]?.migrationHash !== edge.migrationHash) continue;
    if (!reachable.some((e) => e.migrationHash !== edge.migrationHash)) continue;

    const sortedViable = sortedNeighbors(comparisonPool);
    if (
      sortedViable.length > 1 &&
      sortedViable[0]?.migrationHash === edge.migrationHash &&
      sortedViable.some((e) => e.migrationHash !== edge.migrationHash)
    ) {
      tieBreakReasons.push(
        `at ${edge.from}: ${comparisonPool.length} candidates, selected by tie-break`,
      );
    }
  }

  return {
    kind: 'ok',
    decision: {
      selectedPath: path,
      fromHash,
      toHash,
      alternativeCount,
      tieBreakReasons,
      requiredInvariants,
      satisfiedInvariants,
      ...ifDefined('refName', refName),
    },
  };
}

function computeSatisfiedInvariants(
  required: ReadonlySet<string>,
  path: readonly MigrationEdge[],
): readonly string[] {
  if (required.size === 0) return [];
  const covered = new Set<string>();
  for (const edge of path) {
    for (const inv of edge.invariants) {
      if (required.has(inv)) covered.add(inv);
    }
  }
  return [...covered].sort();
}

/**
 * For each edge on path, invariant coverage accumulated from earlier edges only —
 * `(required ∩ ∪_{j<i} path[j].invariants)` represented as cumulative set along `required`,
 * keyed as "full set of required ids satisfied before taking path[i]".
 */
function requiredCoveragePrefixes(
  required: ReadonlySet<string>,
  path: readonly MigrationEdge[],
): readonly ReadonlySet<string>[] {
  const prefixes: ReadonlySet<string>[] = [];
  const acc = new Set<string>();
  for (const edge of path) {
    prefixes.push(new Set(acc));
    for (const inv of edge.invariants) {
      if (required.has(inv)) acc.add(inv);
    }
  }
  return prefixes;
}

function invariantViableAlternativesAtStep(
  required: ReadonlySet<string>,
  coverageBeforeTakingEdge: ReadonlySet<string>,
  outgoing: readonly MigrationEdge[],
): readonly MigrationEdge[] {
  if (required.size === 0) return [...outgoing];
  return outgoing.filter((e) =>
    [...required].every((id) => coverageBeforeTakingEdge.has(id) || e.invariants.includes(id)),
  );
}

export function detectCycles(graph: MigrationGraph): readonly string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const parentMap = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const node of graph.nodes) {
    color.set(node, WHITE);
  }

  // Iterative three-color DFS. A frame is (node, outgoing edges, next-index).
  interface Frame {
    node: string;
    outgoing: readonly MigrationEdge[];
    index: number;
  }
  const stack: Frame[] = [];

  function pushFrame(u: string): void {
    color.set(u, GRAY);
    stack.push({ node: u, outgoing: graph.forwardChain.get(u) ?? [], index: 0 });
  }

  for (const root of graph.nodes) {
    if (color.get(root) !== WHITE) continue;
    parentMap.set(root, null);
    pushFrame(root);

    while (stack.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: stack.length > 0 should guarantee that this cannot be undefined
      const frame = stack[stack.length - 1]!;
      if (frame.index >= frame.outgoing.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      // biome-ignore lint/style/noNonNullAssertion: the early-continue above guarantees frame.index < frame.outgoing.length here, so this is defined
      const edge = frame.outgoing[frame.index++]!;
      const v = edge.to;
      const vColor = color.get(v);
      if (vColor === GRAY) {
        const cycle: string[] = [v];
        let cur = frame.node;
        while (cur !== v) {
          cycle.push(cur);
          cur = parentMap.get(cur) ?? v;
        }
        cycle.reverse();
        cycles.push(cycle);
      } else if (vColor === WHITE) {
        parentMap.set(v, frame.node);
        pushFrame(v);
      }
    }
  }

  return cycles;
}

export function detectOrphans(graph: MigrationGraph): readonly MigrationEdge[] {
  if (graph.nodes.size === 0) return [];

  const reachable = new Set<string>();
  const startNodes: string[] = [];

  if (graph.forwardChain.has(EMPTY_CONTRACT_HASH)) {
    startNodes.push(EMPTY_CONTRACT_HASH);
  } else {
    const allTargets = new Set<string>();
    for (const edges of graph.forwardChain.values()) {
      for (const edge of edges) {
        allTargets.add(edge.to);
      }
    }
    for (const node of graph.nodes) {
      if (!allTargets.has(node)) {
        startNodes.push(node);
      }
    }
  }

  for (const step of bfs(startNodes, (n) => forwardNeighbours(graph, n))) {
    reachable.add(step.state);
  }

  const orphans: MigrationEdge[] = [];
  for (const [from, migrations] of graph.forwardChain) {
    if (!reachable.has(from)) {
      orphans.push(...migrations);
    }
  }

  return orphans;
}
