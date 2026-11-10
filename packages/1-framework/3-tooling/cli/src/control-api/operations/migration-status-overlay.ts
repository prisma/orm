import type { MigrationGraph } from '@internal/migration-tools/graph';
import { findPath } from '@internal/migration-tools/migration-graph';
import type { MigrationEdgeAnnotation } from '../../utils/formatters/migration-graph-labels';

export interface DeriveStatusEdgeAnnotationsInput {
  readonly graph: MigrationGraph;
  readonly targetHash: string;
  readonly originHash: string;
  readonly appliedMigrationHashes: ReadonlySet<string>;
  readonly showAppliedOverlay: boolean;
}

export function deriveStatusEdgeAnnotations(
  input: DeriveStatusEdgeAnnotationsInput,
): ReadonlyMap<string, MigrationEdgeAnnotation> {
  const annotations = new Map<string, MigrationEdgeAnnotation>();

  if (input.showAppliedOverlay) {
    for (const edge of input.graph.migrationByHash.values()) {
      if (input.appliedMigrationHashes.has(edge.migrationHash)) {
        annotations.set(edge.migrationHash, { status: 'applied' });
      }
    }
  }

  if (!input.graph.nodes.has(input.originHash)) {
    return annotations;
  }

  const pendingPath = findPath(input.graph, input.originHash, input.targetHash);
  if (!pendingPath) {
    return annotations;
  }

  for (const edge of pendingPath) {
    if (input.appliedMigrationHashes.has(edge.migrationHash)) {
      continue;
    }
    const existing = annotations.get(edge.migrationHash);
    if (existing?.status === 'applied') {
      continue;
    }
    annotations.set(edge.migrationHash, { status: 'pending' });
  }

  return annotations;
}

export function appliedHashesFromLedger(
  ledgerEntries: ReadonlyArray<{ readonly migrationHash: string }>,
): ReadonlySet<string> {
  return new Set(ledgerEntries.map((entry) => entry.migrationHash));
}

export function statusForMigrationHash(
  migrationHash: string,
  annotations: ReadonlyMap<string, MigrationEdgeAnnotation>,
): 'applied' | 'pending' | null {
  const status = annotations.get(migrationHash)?.status;
  return status ?? null;
}
