import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MigrationGraph } from '@internal/migration-tools/graph';

export type MigrationEdgeKind = 'forward' | 'rollback' | 'self';

export interface MigrationListGraphTopology {
  readonly kindByMigrationHash: ReadonlyMap<string, MigrationEdgeKind>;
  readonly forwardInDegree: ReadonlyMap<string, number>;
  readonly forwardOutDegree: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Shared classifier — operates on a normalized edge shape for MigrationGraph.
// ---------------------------------------------------------------------------

interface NormalizedEdge {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly dirName: string;
}

function compareDirNameDesc(a: NormalizedEdge, b: NormalizedEdge): number {
  return b.dirName.localeCompare(a.dirName);
}

function bumpDegree(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function compareNodesRootFirst(a: string, b: string): number {
  if (a === EMPTY_CONTRACT_HASH) return -1;
  if (b === EMPTY_CONTRACT_HASH) return 1;
  return a.localeCompare(b);
}

/**
 * Shortest-path distance of each node from the forward roots, over the given
 * candidate edges. Roots are the in-degree-0 nodes (baseline first, then lex);
 * a rooted component therefore distances every node by how many forward steps
 * it sits from a root. A component with no root (a pure cycle) is seeded from
 * its single lexically-smallest node so the cycle still gets a stable layering.
 *
 * Crucially this is *shortest* path, not longest: a backward (rollback) edge
 * `deep → shallow` never offers a shorter route to the already-shallower
 * target, so it is inert here. Distances are thus stable whether or not the
 * rollbacks are still in the candidate set — which is what lets the peel below
 * tell a genuine back-edge (target strictly shallower than source) apart from a
 * forward edge that merely happens to share the back-edge's cycle.
 */
function forwardDistances(
  nodes: ReadonlySet<string>,
  candidates: readonly NormalizedEdge[],
): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node, 0);
  }
  for (const edge of candidates) {
    bumpDegree(inDegree, edge.to);
  }

  const roots = [...nodes].filter((node) => (inDegree.get(node) ?? 0) === 0);
  roots.sort(compareNodesRootFirst);
  const seeds = roots.length > 0 ? roots : [...nodes].sort(compareNodesRootFirst).slice(0, 1);

  const dist = new Map<string, number>();
  for (const seed of seeds) {
    dist.set(seed, 0);
  }

  const maxPasses = nodes.size;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const edge of candidates) {
      const base = dist.get(edge.from);
      if (base === undefined) continue;
      const next = base + 1;
      if (next < (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        dist.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const node of nodes) {
    if (!dist.has(node)) {
      dist.set(node, 0);
    }
  }

  return dist;
}

function canReachForward(
  start: string,
  goal: string,
  candidates: readonly NormalizedEdge[],
): boolean {
  if (start === goal) return true;

  const outgoing = new Map<string, string[]>();
  for (const edge of candidates) {
    const bucket = outgoing.get(edge.from);
    if (bucket) bucket.push(edge.to);
    else outgoing.set(edge.from, [edge.to]);
  }

  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) continue;
    for (const next of outgoing.get(node) ?? []) {
      if (next === goal) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return false;
}

/**
 * Demote node-skipping rollbacks left forward by the DFS. An edge `from → to`
 * is a rollback exactly when both hold:
 *   1. `to` is a forward-ancestor of `from` — `to` can still reach `from` over
 *      the other forward edges, so the edge closes a cycle; and
 *   2. `to` is strictly shallower than `from` (smaller forward distance) — the
 *      edge points back toward the root rather than advancing history.
 *
 * Condition 2 is the discriminator: in a cycle created by a rollback every edge
 * satisfies condition 1, but only the rollback itself runs deep → shallow. The
 * forward chain edges run shallow → deep and are never peeled, however many
 * rollbacks converge on the same target. Tight back-edges whose source and
 * target sit at the same distance (mutual two-node cycles) are already resolved
 * by the DFS immediate-parent rule, so they never reach this pass. One edge is
 * peeled per iteration (dirName-descending tie-break) and distances/reachability
 * are recomputed, making the outcome independent of edge input order.
 */
function peelNodeSkippingRollbacks(
  nodes: ReadonlySet<string>,
  kindByMigrationHash: Map<string, MigrationEdgeKind>,
  nonSelf: readonly NormalizedEdge[],
): void {
  let candidates = nonSelf.filter((edge) => kindByMigrationHash.get(edge.hash) === 'forward');

  while (candidates.length > 0) {
    const dist = forwardDistances(nodes, candidates);
    const backEdges = candidates.filter((edge) => {
      const toDist = dist.get(edge.to) ?? 0;
      const fromDist = dist.get(edge.from) ?? 0;
      if (toDist >= fromDist) return false;
      const without = candidates.filter((candidate) => candidate !== edge);
      return canReachForward(edge.to, edge.from, without);
    });
    if (backEdges.length === 0) break;

    backEdges.sort(compareDirNameDesc);
    const rollback = backEdges[0];
    if (rollback === undefined) break;

    kindByMigrationHash.set(rollback.hash, 'rollback');
    candidates = candidates.filter((edge) => edge !== rollback);
  }
}

/**
 * DFS with dirName-descending traversal. A GRAY target is a rollback only when it
 * is the immediate DFS parent of the source — cross-links to other GRAY nodes
 * stay forward. A follow-up peel pass demotes node-skipping rollbacks (target is
 * a forward-ancestor of the source and sits strictly shallower than it).
 */
function classifyNormalizedEdges(edges: readonly NormalizedEdge[]): MigrationListGraphTopology {
  const nodes = new Set<string>();
  const kindByMigrationHash = new Map<string, MigrationEdgeKind>();
  const outgoingByFrom = new Map<string, NormalizedEdge[]>();
  const nonSelf: NormalizedEdge[] = [];

  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);

    if (edge.from === edge.to) {
      kindByMigrationHash.set(edge.hash, 'self');
      continue;
    }

    nonSelf.push(edge);
    const bucket = outgoingByFrom.get(edge.from);
    if (bucket) bucket.push(edge);
    else outgoingByFrom.set(edge.from, [edge]);
  }

  for (const bucket of outgoingByFrom.values()) {
    bucket.sort(compareDirNameDesc);
  }

  const nonSelfInDegree = new Map<string, number>();
  for (const node of nodes) {
    nonSelfInDegree.set(node, 0);
  }
  for (const bucket of outgoingByFrom.values()) {
    for (const edge of bucket) {
      bumpDegree(nonSelfInDegree, edge.to);
    }
  }

  const dfsRoots: string[] = [];
  for (const node of nodes) {
    if ((nonSelfInDegree.get(node) ?? 0) === 0) {
      dfsRoots.push(node);
    }
  }
  dfsRoots.sort((a, b) => {
    if (a === EMPTY_CONTRACT_HASH) return -1;
    if (b === EMPTY_CONTRACT_HASH) return 1;
    return a.localeCompare(b);
  });
  if (dfsRoots.length === 0) {
    dfsRoots.push(...[...nodes].sort((a, b) => a.localeCompare(b)));
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const dfsParent = new Map<string, string | undefined>();
  for (const node of nodes) {
    color.set(node, WHITE);
  }

  interface Frame {
    node: string;
    outgoing: readonly NormalizedEdge[];
    index: number;
  }
  const stack: Frame[] = [];

  function isImmediateDfsParent(ancestor: string, node: string): boolean {
    return dfsParent.get(node) === ancestor;
  }

  function pushFrame(node: string, parent: string | undefined): void {
    color.set(node, GRAY);
    dfsParent.set(node, parent);
    stack.push({ node, outgoing: outgoingByFrom.get(node) ?? [], index: 0 });
  }

  function runDfsFrom(root: string): void {
    if (color.get(root) !== WHITE) return;
    pushFrame(root, undefined);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      if (frame.index >= frame.outgoing.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }

      const edge = frame.outgoing[frame.index];
      frame.index += 1;
      if (edge === undefined) continue;

      const v = edge.to;
      const vColor = color.get(v);
      if (vColor === GRAY && isImmediateDfsParent(v, frame.node)) {
        kindByMigrationHash.set(edge.hash, 'rollback');
      } else {
        kindByMigrationHash.set(edge.hash, 'forward');
        if (vColor === WHITE) {
          pushFrame(v, frame.node);
        }
      }
    }
  }

  for (const root of dfsRoots) {
    runDfsFrom(root);
  }
  const remainingWhite = [...nodes].filter((node) => color.get(node) === WHITE);
  remainingWhite.sort((a, b) => a.localeCompare(b));
  for (const root of remainingWhite) {
    runDfsFrom(root);
  }

  peelNodeSkippingRollbacks(nodes, kindByMigrationHash, nonSelf);

  const forwardInDegree = new Map<string, number>();
  const forwardOutDegree = new Map<string, number>();

  for (const edge of edges) {
    if (kindByMigrationHash.get(edge.hash) !== 'forward') continue;
    bumpDegree(forwardOutDegree, edge.from);
    bumpDegree(forwardInDegree, edge.to);
  }

  return {
    kindByMigrationHash,
    forwardInDegree,
    forwardOutDegree,
  };
}

/**
 * Classify forward/rollback/self for a `MigrationGraph` edge set (Tier-3).
 */
export function classifyMigrationGraphTopology(graph: MigrationGraph): MigrationListGraphTopology {
  const normalized: NormalizedEdge[] = [];
  for (const edges of graph.forwardChain.values()) {
    for (const edge of edges) {
      normalized.push({
        hash: edge.migrationHash,
        from: edge.from,
        to: edge.to,
        dirName: edge.dirName,
      });
    }
  }
  return classifyNormalizedEdges(normalized);
}
