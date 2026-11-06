/**
 * Read-only migration-graph queries commands need at the control-api seam.
 */

import type { MigrationGraph } from '@internal/migration-tools/graph';
import { findPath } from '@internal/migration-tools/migration-graph';

/** True when the on-disk graph contains a path fromHash → toHash. */
export function hasMigrationPath(graph: MigrationGraph, fromHash: string, toHash: string): boolean {
  return findPath(graph, fromHash, toHash) !== null;
}
