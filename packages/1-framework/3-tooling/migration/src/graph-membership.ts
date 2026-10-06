import { EMPTY_CONTRACT_HASH } from './constants';
import { errorHashNotInGraph } from './errors';
import type { MigrationGraph } from './graph';

export function isGraphNode(hash: string, graph: MigrationGraph): boolean {
  if (hash === EMPTY_CONTRACT_HASH) {
    return true;
  }
  return graph.nodes.has(hash);
}

/** True when a marker hash is in a space's history: a graph node, or the head of an extension space that ships no migrations. */
export function isInSpaceHistory(
  hash: string,
  space: {
    readonly graph: MigrationGraph;
    readonly headHash: string | undefined;
    readonly isExtension: boolean;
  },
): boolean {
  if (isGraphNode(hash, space.graph)) {
    return true;
  }
  return space.isExtension && space.graph.nodes.size === 0 && hash === space.headHash;
}

export function assertHashIsGraphNode(hash: string, graph: MigrationGraph): asserts hash is string {
  if (isGraphNode(hash, graph)) {
    return;
  }
  throw errorHashNotInGraph(hash, graph);
}
