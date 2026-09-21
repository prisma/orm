import { notOk, ok } from '@internal/utils/result';
import { requireHeadRef } from './aggregate';
import { allStorageElementsExternal } from './all-external';
import { buildFabricatedMigrationEdge } from './fabricated-migration-edge';
import type { PerSpacePlan, PlannerError, PlannerInput, PlannerOutput } from './planner-types';
import { planFromDiff } from './strategies/plan-from-diff';
import { resolveRecordedPath } from './strategies/resolve-recorded-path';
import type { AggregateContractSpace } from './types';

export type {
  AggregateCurrentDBState,
  AggregateMigrationEdgeRef,
  CallerPolicy,
  PerSpacePlan,
  PlannerError,
  PlannerInput,
  PlannerOutput,
  PlannerSuccess,
} from './planner-types';

/**
 * Plan a migration across every contract space of a {@link ContractSpaceAggregate}.
 *
 * Per-space operation selection, in order; first match wins:
 *
 * 1. If `callerPolicy.ignoreGraphFor.has(space.spaceId)`:
 *    - If `space.headRef.invariants` is empty → `planFromDiff`.
 *    - Else → `policyConflict` (a diff-fabricated plan cannot satisfy
 *      authored invariants).
 * 2. Else if `space.graph()` is non-empty AND `resolveRecordedPath`
 *    succeeds → its result.
 * 3. Else if `space.graph()` is non-empty but unresolvable →
 *    `extensionPathUnreachable` / `extensionPathUnsatisfiable`.
 * 4. Else (empty graph — the space ships no migration packages at all,
 *    e.g. an all-external extension space like Supabase's `auth`/`storage`)
 *    if `space.headRef.invariants` is empty → declare the no-op state
 *    directly (zero ops, destination = head ref) without invoking the
 *    family planner.
 * 5. Else → `extensionPathUnsatisfiable` (an empty graph cannot satisfy
 *    non-empty invariants).
 *
 * Output `applyOrder` is `[...aggregate.extensions.map(spaceId), aggregate.app.spaceId]`
 * — extensions alphabetical, then app — matching today's
 * `concatenateSpaceApplyInputs` ordering. This preserves
 * `MigrationRunnerFailure.failingSpace` attribution byte-for-byte.
 *
 * Every emitted `MigrationPlan` has `targetId = aggregate.targetId`.
 * No placeholder cast; no patch step.
 */
export async function planMigration<TFamilyId extends string, TTargetId extends string>(
  input: PlannerInput<TFamilyId, TTargetId>,
): Promise<PlannerOutput> {
  const { aggregate, currentDBState, callerPolicy } = input;

  const perSpace = new Map<string, PerSpacePlan>();

  // Iterate in apply order so a per-space error short-circuits the
  // walk in the same order the runner would walk inputs.
  const orderedSpaces: ReadonlyArray<AggregateContractSpace> = [
    ...aggregate.extensions,
    aggregate.app,
  ];

  for (const space of orderedSpaces) {
    const currentMarker = currentDBState.markersBySpaceId.get(space.spaceId) ?? null;
    const headRef = requireHeadRef(space);

    const ignoreGraph = callerPolicy.ignoreGraphFor.has(space.spaceId);
    const invariantsRequired = headRef.invariants.length > 0;

    if (ignoreGraph && invariantsRequired) {
      const conflict: PlannerError = {
        kind: 'policyConflict',
        spaceId: space.spaceId,
        detail: `\`callerPolicy.ignoreGraphFor\` requested for space "${space.spaceId}", but the contract space declares non-empty head-ref invariants (${headRef.invariants.join(', ')}). A plan built directly from the contract IR cannot satisfy authored invariants — the graph must be walked. Either remove "${space.spaceId}" from \`ignoreGraphFor\` or amend the on-disk head ref to declare zero invariants.`,
      };
      return notOk(conflict);
    }

    if (ignoreGraph) {
      const diffOutcome = await planFromDiff({
        aggregateTargetId: aggregate.targetId,
        currentMarker,
        space,
        ownership: aggregate,
        schemaIntrospection: currentDBState.schemaIntrospection,
        adapter: input.adapter,
        migrations: input.migrations,
        frameworkComponents: input.frameworkComponents,
        operationPolicy: input.operationPolicy,
      });
      if (diffOutcome.kind === 'failure') {
        return notOk({
          kind: 'planFromDiffFailed',
          spaceId: space.spaceId,
          conflicts: diffOutcome.conflicts,
        });
      }
      perSpace.set(space.spaceId, diffOutcome.result);
      continue;
    }

    // Resolve the recorded path first when the graph has nodes; fall back
    // to the empty-graph case below when the graph is empty AND no
    // invariants are required.
    if (space.graph().nodes.size > 0) {
      const resolved = resolveRecordedPath({
        aggregateTargetId: aggregate.targetId,
        space,
        currentMarker,
      });
      if (resolved.kind === 'ok') {
        perSpace.set(space.spaceId, resolved.result);
        continue;
      }
      if (resolved.kind === 'unreachable') {
        return notOk({
          kind: 'extensionPathUnreachable',
          spaceId: space.spaceId,
          target: headRef.hash,
        });
      }
      // unsatisfiable — surface
      return notOk({
        kind: 'extensionPathUnsatisfiable',
        spaceId: space.spaceId,
        missingInvariants: resolved.missing,
      });
    }

    // Empty graph: the space ships no migration packages at all. It can
    // only ever satisfy empty-invariant contract spaces.
    if (invariantsRequired) {
      return notOk({
        kind: 'extensionPathUnsatisfiable',
        spaceId: space.spaceId,
        missingInvariants: [...headRef.invariants].sort(),
      });
    }

    // Advancing without migrations is valid exclusively for a space whose
    // elements are ALL externally managed (e.g. Supabase's `auth`/`storage`
    // — nothing Prisma 8 owns exists there, so the declared state needs
    // no migration to be true). A space that declares a managed element but
    // ships no migration graph is an authoring bug and must fail loudly.
    // The same predicate guards the replay path in the CLI's
    // `planSpacePath` (control-api/operations/migrate.ts).
    if (!allStorageElementsExternal(space.contract())) {
      return notOk({
        kind: 'extensionPathUnreachable',
        spaceId: space.spaceId,
        target: headRef.hash,
      });
    }

    // Declare the no-op state directly instead of invoking the family
    // planner: a diff-fabricated plan only ever came out empty here
    // anyway (control-policy disposition drops everything the space
    // doesn't manage), so this constructs that same fixed point.
    perSpace.set(space.spaceId, {
      plan: {
        targetId: aggregate.targetId,
        spaceId: space.spaceId,
        origin: currentMarker === null ? null : { storageHash: currentMarker.storageHash },
        destination: { storageHash: headRef.hash },
        operations: [],
      },
      displayOps: [],
      destinationContract: space.contract(),
      strategy: 'declared-state',
      migrationEdges: [
        buildFabricatedMigrationEdge({
          currentMarkerStorageHash: currentMarker?.storageHash,
          destinationStorageHash: headRef.hash,
          operationCount: 0,
        }),
      ],
    });
  }

  return ok({
    perSpace,
    applyOrder: [...aggregate.extensions.map((m) => m.spaceId), aggregate.app.spaceId],
  });
}
