/**
 * Read-only migration-graph queries commands need at the control-api seam.
 */

import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import { findPath } from '@internal/migration-tools/migration-graph';

/** True when the on-disk graph contains a path fromHash → toHash. */
export function hasMigrationPath(graph: MigrationGraph, fromHash: string, toHash: string): boolean {
  return findPath(graph, fromHash, toHash) !== null;
}

function reachableFrom(graph: MigrationGraph, hash: string): ReadonlySet<string> {
  const reached = new Set([hash]);
  const pending = [hash];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const edge of graph.forwardChain.get(node) ?? []) {
      if (!reached.has(edge.to)) {
        reached.add(edge.to);
        pending.push(edge.to);
      }
    }
  }
  return reached;
}

/** The contracts reachable from `hash` that no migration leads on from. */
function tipsReachableFrom(graph: MigrationGraph, hash: string): readonly string[] {
  return [...reachableFrom(graph, hash)].filter(
    (node) => (graph.forwardChain.get(node) ?? []).length === 0,
  );
}

/** What advice prints for `--from` when it cannot tell which migration the new one follows. */
export const UNKNOWN_PLAN_ORIGIN = '<contract>';

/**
 * What `migration plan --from` takes to plan the migration a database at `originHash` needs next,
 * or `undefined` when the space has no migrations, where `migration plan` needs no `--from`. A
 * database at a contract plans from it. An empty database plans from where its history ends, since a
 * plan from the empty contract would recreate what the existing migrations create; when the history
 * has no single end, the user has to name the contract.
 */
export function planOriginArgument(graph: MigrationGraph, originHash: string): string | undefined {
  if (originHash !== EMPTY_CONTRACT_HASH) return originHash;
  if (graph.nodes.size === 0) return undefined;
  const tips = tipsReachableFrom(graph, EMPTY_CONTRACT_HASH);
  if (tips.length !== 1) return UNKNOWN_PLAN_ORIGIN;
  return tips[0] === EMPTY_CONTRACT_HASH ? '@empty' : tips[0];
}
