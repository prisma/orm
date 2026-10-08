import type { MigrationPlan, MigrationPlanOperation } from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';
import { EMPTY_CONTRACT_HASH } from '../../constants';
import { findPathWithDecision } from '../../migration-graph';
import type { MigrationOps, OnDiskMigrationPackage } from '../../package';
import { requireHeadRef } from '../aggregate';
import type { ContractMarkerRecordLike } from '../marker-types';
import type { AggregateMigrationEdgeRef, PerSpacePlan } from '../planner-types';
import type { AggregateContractSpace } from '../types';

/**
 * Outcome variants for resolving a contract space's recorded migration
 * path. Mirrors
 * {@link import('../../compute-extension-space-apply-path').ExtensionSpaceApplyPathOutcome}
 * but operates against the contract space's lazily-reconstructed `graph()`
 * instead of re-reading from disk. The aggregate planner converts
 * these into {@link import('../planner-types').PlannerError}
 * variants.
 */
export type ResolveRecordedPathOutcome =
  | { readonly kind: 'ok'; readonly result: PerSpacePlan }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'unsatisfiable'; readonly missing: readonly string[] };

export interface ResolveRecordedPathInputs {
  readonly aggregateTargetId: string;
  readonly space: AggregateContractSpace;
  readonly currentMarker: ContractMarkerRecordLike | null;
  /**
   * Optional ref name to decorate the resulting `PathDecision`. Used by
   * `migrate` to surface the user-supplied `--to <name>` in
   * structured-progress events and invariant-path error envelopes. The
   * strategy itself does not interpret it.
   */
  readonly refName?: string;
  /** The name the database knows the object an operation acts on by; names what a drop loses. */
  readonly storageNameOf: (operation: MigrationPlanOperation) => string;
}

/**
 * Resolve a contract space's hydrated migration graph to the path from the
 * live marker to `space.headRef.hash`, covering every required invariant.
 *
 * Pure synchronous function — no I/O. The aggregate's loader has
 * already integrity-checked every package and reconstructed the graph;
 * this resolves the path by looking up ops by `migrationHash` and
 * assembles a `MigrationPlan` with `targetId` set from the aggregate (no
 * placeholder cast).
 *
 * Required invariants are computed as `headRef.invariants \ marker.invariants`
 * — the marker already declares some invariants satisfied; the path
 * only needs to provide the remainder. Mirrors today's
 * `computeExtensionSpaceApplyPath` semantics.
 */
export function resolveRecordedPath(input: ResolveRecordedPathInputs): ResolveRecordedPathOutcome {
  const { aggregateTargetId, space, currentMarker, refName } = input;
  const headRef = requireHeadRef(space);
  const graph = space.graph();
  const packagesByMigrationHash = new Map<string, OnDiskMigrationPackage>(
    space.packages.map((pkg) => [pkg.metadata.migrationHash, pkg]),
  );

  const fromHash = currentMarker?.storageHash ?? EMPTY_CONTRACT_HASH;
  const markerInvariants = new Set(currentMarker?.invariants ?? []);
  const required = new Set(headRef.invariants.filter((id) => !markerInvariants.has(id)));

  const outcome = findPathWithDecision(graph, fromHash, headRef.hash, {
    required,
    ...(refName !== undefined ? { refName } : {}),
  });

  if (outcome.kind === 'unreachable') {
    return { kind: 'unreachable' };
  }
  if (outcome.kind === 'unsatisfiable') {
    return { kind: 'unsatisfiable', missing: outcome.missing };
  }

  const pathOps: MigrationOps[number][] = [];
  const providedInvariantsSet = new Set<string>();
  const edgeRefs: AggregateMigrationEdgeRef[] = [];
  for (const edge of outcome.decision.selectedPath) {
    const pkg = packagesByMigrationHash.get(edge.migrationHash);
    if (!pkg) {
      throw new InternalError(
        `Migration package missing for edge ${edge.migrationHash} in space "${space.spaceId}". The hydrated migration graph and packagesByMigrationHash map are out of sync — this should be unreachable; report.`,
      );
    }
    for (const op of pkg.ops) pathOps.push(op);
    for (const invariant of pkg.metadata.providedInvariants) providedInvariantsSet.add(invariant);
    edgeRefs.push({
      migrationHash: edge.migrationHash,
      dirName: edge.dirName,
      from: edge.from,
      to: edge.to,
      operationCount: pkg.ops.length,
      ...(pkg.endContractJson !== undefined
        ? { destinationContractJson: pkg.endContractJson }
        : {}),
    });
  }

  const plan: MigrationPlan = {
    targetId: aggregateTargetId,
    spaceId: space.spaceId,
    origin: currentMarker === null ? null : { storageHash: currentMarker.storageHash },
    destination: { storageHash: headRef.hash },
    operations: pathOps,
    providedInvariants: [...providedInvariantsSet].sort(),
  };

  return {
    kind: 'ok',
    result: {
      plan,
      displayOps: pathOps,
      destinationContract: space.contract(),
      strategy: 'resolve-recorded-path',
      appliedStatements: [],
      dataLoss: pathOps.flatMap((operation, operationIndex) =>
        operation.operationClass === 'destructive'
          ? [
              {
                operationIndex,
                subject: { kind: 'storage' as const, name: input.storageNameOf(operation) },
              },
            ]
          : [],
      ),
      accessWidening: [],
      migrationEdges: edgeRefs,
      pathDecision: outcome.decision,
    },
  };
}
