import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import {
  hasMigrationPath,
  refuseMarkerOutsideGraph,
} from '../../src/control-api/operations/graph-queries';
import { errorMarkerMismatch } from '../../src/utils/cli-errors';
import { buildGraph, entry } from '../utils/graph-helpers';

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const HASH_FOREIGN = `${'f'.repeat(64)}`;

const graph = buildGraph([entry(EMPTY_CONTRACT_HASH, HASH_A, 'm1'), entry(HASH_A, HASH_B, 'm2')]);
const forkedGraph = buildGraph([
  entry(EMPTY_CONTRACT_HASH, HASH_A, 'm1'),
  entry(EMPTY_CONTRACT_HASH, HASH_B, 'm2'),
]);

describe('hasMigrationPath', () => {
  it('reports true when the graph contains a forward path', () => {
    expect(hasMigrationPath(graph, HASH_A, HASH_B)).toBe(true);
  });

  it('reports false when no path exists', () => {
    expect(hasMigrationPath(graph, HASH_B, HASH_A)).toBe(false);
  });
});

describe('refuseMarkerOutsideGraph', () => {
  it('returns null when the marker hash is a graph node', () => {
    expect(refuseMarkerOutsideGraph({ markerHash: HASH_A, graph })).toBeNull();
  });

  it('returns the errorMarkerMismatch envelope with sorted nodes', () => {
    const refusal = refuseMarkerOutsideGraph({ markerHash: HASH_FOREIGN, graph });
    expect(refusal).not.toBeNull();
    expect(refusal?.toEnvelope()).toEqual(
      errorMarkerMismatch(HASH_FOREIGN, [...graph.nodes].sort()).toEnvelope(),
    );
  });

  it('names the empty graph when there are no nodes', () => {
    const empty = buildGraph([]);
    const refusal = refuseMarkerOutsideGraph({ markerHash: HASH_FOREIGN, graph: empty });
    expect(refusal?.toEnvelope()).toEqual(errorMarkerMismatch(HASH_FOREIGN, []).toEnvelope());
  });

  it('refuses with MARKER_MISMATCH on a forked graph instead of failing on the fork', () => {
    const refusal = refuseMarkerOutsideGraph({ markerHash: HASH_FOREIGN, graph: forkedGraph });
    expect(refusal?.toEnvelope()).toMatchObject({
      code: 'MIGRATION.MARKER_MISMATCH',
      meta: { markerHash: HASH_FOREIGN, reachableHashes: [...forkedGraph.nodes].sort() },
    });
  });

  it('returns null when the marker is a node of a forked graph', () => {
    expect(refuseMarkerOutsideGraph({ markerHash: HASH_B, graph: forkedGraph })).toBeNull();
  });
});
