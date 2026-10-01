/**
 * Read-only migration-graph queries commands need at the control-api seam: path existence and the live-marker membership refusal.
 */

import type { MigrationGraph } from '@internal/migration-tools/graph';
import { findPath, isGraphNode } from '@internal/migration-tools/migration-graph';
import { type CliStructuredError, errorMarkerMismatch } from '../../utils/cli-errors';

/** True when the on-disk graph contains a path fromHash → toHash. */
export function hasMigrationPath(graph: MigrationGraph, fromHash: string, toHash: string): boolean {
  return findPath(graph, fromHash, toHash) !== null;
}

/**
 * Refusal for a live marker hash that is not a node of the on-disk app graph.
 * Same errorMarkerMismatch envelope migrate raises today, or null when the marker is a node.
 */
export function refuseMarkerOutsideGraph(args: {
  readonly markerHash: string;
  readonly graph: MigrationGraph;
}): CliStructuredError | null {
  if (isGraphNode(args.markerHash, args.graph)) {
    return null;
  }
  return errorMarkerMismatch(args.markerHash, [...args.graph.nodes].sort());
}
