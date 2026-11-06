import {
  errorNoInvariantPath,
  type MigrationToolsError,
  type NoInvariantPathStructuralEdge,
} from '@internal/migration-tools/errors';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import { findPathWithDecision } from '@internal/migration-tools/migration-graph';

/**
 * The path from `fromHash` to `targetHash` when invariants are ignored, or none. A space with no
 * marker starts from the empty contract's hash, so the path is found even then.
 */
export function structuralPathOf(
  graph: MigrationGraph,
  fromHash: string,
  targetHash: string,
): readonly NoInvariantPathStructuralEdge[] {
  const structural = findPathWithDecision(graph, fromHash, targetHash, {
    required: new Set<string>(),
  });
  return structural.kind === 'ok'
    ? structural.decision.selectedPath.map((edge) => ({
        dirName: edge.dirName,
        migrationHash: edge.migrationHash,
        from: edge.from,
        to: edge.to,
        invariants: edge.invariants,
      }))
    : [];
}

/**
 * `MIGRATION.NO_INVARIANT_PATH` for a space whose graph reaches `targetHash` from `fromHash` but
 * provides none of `missing`, naming the path that ignores invariants.
 */
export function noInvariantPathError(input: {
  readonly graph: MigrationGraph;
  readonly fromHash: string;
  readonly targetHash: string;
  readonly required: readonly string[];
  readonly missing: readonly string[];
  readonly refName?: string;
}): MigrationToolsError {
  return errorNoInvariantPath({
    ...(input.refName !== undefined ? { refName: input.refName } : {}),
    required: input.required,
    missing: input.missing,
    structuralPath: structuralPathOf(input.graph, input.fromHash, input.targetHash),
  });
}
