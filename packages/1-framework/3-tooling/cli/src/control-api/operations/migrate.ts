/**
 * Backs the `migrate` command. Resolves the recorded path for every space, replay-only (no introspect/diff/planner).
 */

import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import {
  type AggregateContractSpace,
  allStorageElementsExternal,
  buildFabricatedMigrationEdge,
  type ContractMarkerRecordLike,
  type ContractSpaceAggregate,
  type PerSpacePlan,
  requireHeadRef,
  resolveRecordedPath,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { errorNoInvariantPath } from '@internal/migration-tools/errors';
import { findPathWithDecision } from '@internal/migration-tools/migration-graph';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import type {
  MigrateFailure,
  MigratePathDecision,
  MigrateResult,
  MigrateSuccess,
  OnControlProgress,
  PerSpaceExecutionEntry,
} from '../types';
import {
  type BuildAggregateInputs,
  buildContractSpaceAggregate,
} from './contract-space-aggregate-loader';
import { buildPerSpaceBreakdown, runMigration } from './run-migration';

/**
 * Inputs for the aggregate-walking `migrate` control-api
 * operation.
 *
 * The CLI command resolves the descriptor surface (config, refs,
 * contract envelope) and hands a flat input through. The operation
 * is the single descriptor-free seam between the CLI and the
 * aggregate runtime.
 */
export interface ExecuteMigrateOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  /** Already-validated app contract (the canonical "where we are heading" hash). */
  readonly contract: Contract;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly migrationsDir: string;
  readonly extensions: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  readonly targetId: TTargetId;
  /**
   * Optional app-space ref override. When provided, the app space's
   * graph-walk targets this hash instead of `space.headRef.hash`.
   * Extensions are unaffected — they always walk to their own head.
   */
  readonly refHash?: string;
  /**
   * Required invariants attached to the user-supplied app-space ref.
   * Threaded into the graph-walk's `required` calculation so the
   * planner picks an invariant-bearing path and surfaces the
   * required/satisfied set on the success envelope. When `refHash`
   * is absent the file's `space.headRef.invariants` are used.
   */
  readonly refInvariants?: readonly string[];
  /**
   * Resolved name of the user-supplied app-space ref. Surfaces in
   * `pathDecision.refName` and in `MIGRATION.NO_INVARIANT_PATH`
   * error envelopes so diagnostics name what the user actually
   * passed (`--ref prod`) instead of a synthetic placeholder.
   * Ignored when `refHash` is absent.
   */
  readonly refName?: string;
  readonly onProgress?: OnControlProgress;
}

/**
 * Apply pending migrations across every contract space (app +
 * extensions). Replay-only: graph-walk against the on-disk graph for
 * every contract space; no synth, no introspection.
 *
 * Pipeline:
 *
 * 1. Load aggregate from disk (loader hydrates extension graphs;
 *    caller provides app-space packages).
 * 2. Read live marker rows per space (`familyInstance.readAllMarkers`).
 * 3. Per space: `resolveRecordedPath` plots the path from the live
 *    marker to `space.headRef.hash` (or `refHash` for the app
 *    space when provided). An empty-graph space whose elements are ALL
 *    externally managed resolves declaratively (marker to head, zero
 *    ops), mirroring the db-init aggregate planner: such a space ships
 *    no DDL and has nothing to author. Every other empty-graph space
 *    fails loudly — "never planned" is a user-error condition for
 *    replay.
 * 4. Hand off to {@link runMigration} (the runner-driving tail
 *    shared with `db init` / `db update`). Marker advancement is
 *    inside the per-space transaction.
 *
 * Encodes the replay-only contract: the app contract space must have an
 * authored migration graph on disk before this operation can advance it.
 */
export async function executeMigrate<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteMigrateOptions<TFamilyId, TTargetId>,
): Promise<MigrateResult> {
  const {
    driver,
    familyInstance,
    contract,
    migrations,
    frameworkComponents,
    migrationsDir,
    extensions,
    targetId,
    refHash,
    refInvariants,
    refName,
    onProgress,
  } = options;

  const loadInputs: BuildAggregateInputs<TFamilyId, TTargetId> = {
    targetId,
    migrationsDir,
    appContract: contract,
    extensions,
    deserializeContract: (json) => familyInstance.deserializeContract(json),
  };
  const loaded = await buildContractSpaceAggregate(loadInputs);
  if (!loaded.ok) {
    throw loaded.failure;
  }
  const aggregate = loaded.value;

  const markerRows = await familyInstance.readAllMarkers({ driver });

  // Plan every space via graph-walk. App space targets `refHash`
  // when provided, otherwise its own head; extensions always walk
  // to their own head ref.
  const allSpaces: ReadonlyArray<AggregateContractSpace> = [aggregate.app, ...aggregate.extensions];
  const perSpacePlans = new Map<string, PerSpacePlan>();
  // Already-at-head empty-graph spaces (typically extensions whose
  // head ref is the empty sentinel, or whose live marker already
  // matches the target). Kept out of the runner schedule so we don't
  // write spurious markers for greenfield extensions, but merged back
  // into the success envelope so every loaded space is represented.
  const atHeadResolutions = new Map<string, PerSpacePlan>();
  for (const space of allSpaces) {
    const isAppSpace = space.spaceId === aggregate.app.spaceId;
    // The aggregate passed the integrity gate, so every space's head ref
    // is resolved (the app's is synthesised from the live contract).
    const headRef = requireHeadRef(space);
    const spaceTargetHash = isAppSpace && refHash !== undefined ? refHash : headRef.hash;
    const spaceRefInvariants = isAppSpace && refHash !== undefined ? refInvariants : undefined;
    const liveMarker = markerRows.get(space.spaceId) ?? null;

    const outcome = planSpacePath({
      space,
      aggregate,
      targetHash: spaceTargetHash,
      refInvariants: spaceRefInvariants,
      liveMarker,
      ...(isAppSpace ? { refName } : {}),
    });

    if (outcome.kind === 'at-head') {
      // Empty-graph space whose live marker already matches the target.
      // Kept out of the runner schedule so we don't write spurious markers
      // for greenfield extensions, but merged back into the success envelope
      // so every loaded space is represented.
      atHeadResolutions.set(space.spaceId, outcome.plan);
      continue;
    }
    if (outcome.kind === 'never-planned') {
      return notOk(buildNeverPlannedFailure(outcome.spaceId, outcome.targetHash, migrationsDir));
    }
    if (outcome.kind === 'unreachable') {
      return notOk(
        buildPathNotFoundFailure(outcome.spaceId, outcome.liveMarker, outcome.targetHash),
      );
    }
    if (outcome.kind === 'unsatisfiable') {
      // Surface the canonical MIGRATION.NO_INVARIANT_PATH envelope
      // (the error rendering pipeline maps it to meta.code +
      // meta.required + meta.missing + meta.structuralPath that the
      // cli-journeys invariant suite asserts on).
      // Greenfield runs (no marker yet) use the canonical empty-hash
      // sentinel so the structural path stays attached to the
      // `MIGRATION.NO_INVARIANT_PATH` error envelope. Using an empty
      // string here would leave the structural lookup with a hash that
      // is never a graph node, producing an empty `structuralPath` and
      // a less actionable diagnostic.
      const structural = findPathWithDecision(
        outcome.targetSpace.graph(),
        outcome.liveHash,
        spaceTargetHash,
        { required: new Set<string>() },
      );
      const structuralPath =
        structural.kind === 'ok'
          ? structural.decision.selectedPath.map((edge) => ({
              dirName: edge.dirName,
              migrationHash: edge.migrationHash,
              from: edge.from,
              to: edge.to,
              invariants: edge.invariants,
            }))
          : [];
      throw errorNoInvariantPath({
        ...(outcome.refName !== undefined ? { refName: outcome.refName } : {}),
        required: outcome.targetInvariants,
        missing: outcome.missing,
        structuralPath,
      });
    }

    perSpacePlans.set(space.spaceId, outcome.plan);
  }

  const canonicalOrder = [...aggregate.extensions.map((m) => m.spaceId), aggregate.app.spaceId];
  const applyOrder = canonicalOrder.filter((spaceId) => perSpacePlans.has(spaceId));

  // Short-circuit: nothing pending across any space (no runner-bound
  // plans). Surfaces every loaded space — including at-head empty-
  // graph extensions — in `perSpace[]` so the result reflects the
  // full aggregate, not just the spaces the runner would have touched.
  // A zero-op plan still counts as pending when it advances a marker
  // (declared-state resolution for an all-external extension space).
  const hasPendingWork = applyOrder.some((spaceId) => {
    const entry = perSpacePlans.get(spaceId);
    return entry !== undefined && planRequiresExecution(entry);
  });
  if (!hasPendingWork) {
    const ordered = canonicalOrder
      .filter((spaceId) => perSpacePlans.has(spaceId) || atHeadResolutions.has(spaceId))
      .map((spaceId) => {
        const entry = perSpacePlans.get(spaceId) ?? atHeadResolutions.get(spaceId);
        if (entry === undefined) {
          throw new InternalError(`Unreachable: missing per-space plan for "${spaceId}"`);
        }
        return { spaceId, entry };
      });
    const perSpace = buildPerSpaceBreakdown(ordered, aggregate.app.spaceId, {
      includeMarkers: true,
    });
    const totalSpaces = ordered.length;
    return ok(
      buildSuccess({
        aggregate,
        orderedResolutions: ordered,
        perSpace,
        totalOpsExecuted: 0,
        summary:
          totalSpaces === 0
            ? 'Already up to date — no contract spaces are loaded'
            : totalSpaces === 1
              ? 'Already up to date'
              : `Already up to date across ${totalSpaces} space(s)`,
      }),
    );
  }

  const applied = await runMigration({
    aggregate,
    perSpacePlans,
    applyOrder,
    driver,
    familyInstance,
    migrations,
    frameworkComponents,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    action: 'migrate',
    ...ifDefined('onProgress', onProgress),
  });

  if (!applied.ok) {
    const failure: MigrateFailure = {
      code: 'RUNNER_FAILED',
      summary: applied.failure.summary,
      why: applied.failure.why,
      meta: applied.failure.meta,
      ...ifDefined('cause', applied.failure.cause),
    };
    return notOk(failure);
  }

  // Merge at-head zero-op resolutions back into the canonical order
  // so the success envelope surfaces every loaded space, not just
  // those the runner executed.
  const orderedAll = canonicalOrder
    .filter((spaceId) => perSpacePlans.has(spaceId) || atHeadResolutions.has(spaceId))
    .map((spaceId) => {
      if (perSpacePlans.has(spaceId)) {
        const fromRunner = applied.value.orderedResolutions.find((r) => r.spaceId === spaceId);
        if (fromRunner !== undefined) return fromRunner;
      }
      const entry = atHeadResolutions.get(spaceId);
      if (entry === undefined) {
        throw new InternalError(`Unreachable: missing per-space plan for "${spaceId}"`);
      }
      return { spaceId, entry };
    });
  const perSpaceAll = buildPerSpaceBreakdown(orderedAll, aggregate.app.spaceId, {
    includeMarkers: true,
  });
  const totalMigrationsApplied = applied.value.orderedResolutions.reduce(
    (sum, r) => sum + r.entry.migrationEdges.length,
    0,
  );
  const summary = `Applied ${totalMigrationsApplied} migration(s) (${applied.value.totalOpsExecuted} operation(s)) across ${orderedAll.length} contract space(s)`;

  return ok(
    buildSuccess({
      aggregate,
      orderedResolutions: orderedAll,
      perSpace: perSpaceAll,
      totalOpsExecuted: applied.value.totalOpsExecuted,
      summary,
    }),
  );
}

/**
 * Outcome variants for one space's path computation.
 *
 * Callers switch on `kind` and map to their own error representation:
 * `executeMigrate` throws / returns `notOk`; `executeMigrateShowCommand`
 * returns a CLI structured error. The shared discriminant guarantees both
 * paths feed `resolveRecordedPath` the same inputs.
 *
 * @internal Exported for `executeMigrateShowCommand` to call.
 */
export type SpacePathOutcome =
  | { readonly kind: 'ok'; readonly plan: PerSpacePlan }
  | { readonly kind: 'at-head'; readonly plan: PerSpacePlan }
  | { readonly kind: 'never-planned'; readonly spaceId: string; readonly targetHash: string }
  | {
      readonly kind: 'unreachable';
      readonly spaceId: string;
      readonly liveMarker: ContractMarkerRecordLike | null;
      readonly targetHash: string;
    }
  | {
      readonly kind: 'unsatisfiable';
      readonly spaceId: string;
      readonly isAppSpace: boolean;
      readonly missing: readonly string[];
      readonly targetInvariants: readonly string[];
      readonly targetSpace: AggregateContractSpace;
      readonly liveHash: string;
      readonly refName: string | undefined;
    };

/**
 * Compute the graph-walk path for one contract space.
 *
 * Encapsulates the invariant-correct input assembly that both
 * `executeMigrate` and `executeMigrateShowCommand` must use:
 * - `currentMarker` carries the full live marker including `invariants`
 *   (not a stripped `{ storageHash, invariants: [] }` shell).
 * - `targetInvariants` uses the caller-supplied `refInvariants` when a
 *   `--to` ref was resolved (not always the file head ref's invariants).
 *
 * Both callers map the returned `SpacePathOutcome` to their own error
 * representation; the path-compute logic is shared and identical.
 *
 * @internal Exported for `executeMigrateShowCommand`.
 */
export function planSpacePath({
  space,
  aggregate,
  targetHash,
  refInvariants,
  liveMarker,
  refName,
}: {
  readonly space: AggregateContractSpace;
  readonly aggregate: Pick<ContractSpaceAggregate, 'targetId' | 'app'>;
  readonly targetHash: string;
  readonly refInvariants: readonly string[] | undefined;
  readonly liveMarker: ContractMarkerRecordLike | null;
  readonly refName?: string;
}): SpacePathOutcome {
  const isAppSpace = space.spaceId === aggregate.app.spaceId;
  const headRef = requireHeadRef(space);

  if (space.graph().nodes.size === 0) {
    const liveHash = liveMarker?.storageHash;
    if (targetHash === liveHash || (liveHash === undefined && targetHash === EMPTY_CONTRACT_HASH)) {
      return {
        kind: 'at-head',
        plan: buildAtHeadResolution({
          aggregateTargetId: aggregate.targetId,
          space,
          targetHash,
          liveMarker,
        }),
      };
    }
    // Empty-graph extension space not yet at head: the space ships no
    // migration packages at all. Advancing the marker without migrations
    // (the db-init aggregate planner's declared-state strategy, mirrored
    // here) is valid exclusively when every element the space declares is
    // externally managed — nothing Prisma ORM owns exists in such a space
    // (e.g. Supabase's auth/storage), so its declared state needs no
    // migration to be true, and there is no command that could author an
    // edge for it. A space that declares a managed element but ships no
    // migration graph is an authoring bug: it falls through to the
    // never-planned failure, like an app space with no authored graph.
    if (!isAppSpace && allStorageElementsExternal(space.contract())) {
      if (headRef.invariants.length > 0) {
        return {
          kind: 'unsatisfiable',
          spaceId: space.spaceId,
          isAppSpace,
          missing: [...headRef.invariants].sort(),
          targetInvariants: headRef.invariants,
          targetSpace: space,
          liveHash: liveHash ?? EMPTY_CONTRACT_HASH,
          refName: undefined,
        };
      }
      return {
        kind: 'ok',
        plan: buildAtHeadResolution({
          aggregateTargetId: aggregate.targetId,
          space,
          targetHash,
          liveMarker,
        }),
      };
    }
    return { kind: 'never-planned', spaceId: space.spaceId, targetHash };
  }

  const targetInvariants =
    isAppSpace && refInvariants !== undefined ? refInvariants : headRef.invariants;
  const targetSpace: AggregateContractSpace =
    targetHash === headRef.hash && targetInvariants === headRef.invariants
      ? space
      : { ...space, headRef: { hash: targetHash, invariants: targetInvariants } };

  const walked = resolveRecordedPath({
    aggregateTargetId: aggregate.targetId,
    space: targetSpace,
    currentMarker: liveMarker,
    ...(isAppSpace && refName !== undefined ? { refName } : {}),
  });

  if (walked.kind === 'unreachable') {
    return { kind: 'unreachable', spaceId: space.spaceId, liveMarker, targetHash };
  }
  if (walked.kind === 'unsatisfiable') {
    const liveHash = liveMarker?.storageHash ?? EMPTY_CONTRACT_HASH;
    return {
      kind: 'unsatisfiable',
      spaceId: space.spaceId,
      isAppSpace,
      missing: walked.missing,
      targetInvariants,
      targetSpace,
      liveHash,
      refName,
    };
  }
  return { kind: 'ok', plan: walked.result };
}

/**
 * Build a zero-op {@link PerSpacePlan} for an empty-graph space —
 * either one whose live marker already matches the target (at-head), or
 * an all-external extension space whose marker must advance to the head
 * ref with no DDL (declared-state). Lets the apply pipeline thread the
 * space through `perSpacePlans` -> `applyOrder` -> the success
 * envelope's `perSpace[]` block so the result reflects every loaded
 * space, even when there is nothing to execute.
 */
function buildAtHeadResolution(args: {
  readonly aggregateTargetId: string;
  readonly space: AggregateContractSpace;
  readonly targetHash: string;
  readonly liveMarker: ContractMarkerRecordLike | null;
}): PerSpacePlan {
  const { aggregateTargetId, space, targetHash, liveMarker } = args;
  return {
    plan: {
      targetId: aggregateTargetId,
      spaceId: space.spaceId,
      origin: liveMarker === null ? null : { storageHash: liveMarker.storageHash },
      destination: { storageHash: targetHash },
      operations: [],
      providedInvariants: [],
    },
    displayOps: [],
    destinationContract: space.contract(),
    strategy: 'declared-state',
    migrationEdges: [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: liveMarker?.storageHash,
        destinationStorageHash: targetHash,
        operationCount: 0,
      }),
    ],
  };
}

/**
 * A plan needs the runner when it executes operations or advances the
 * space's marker (a declared-state resolution has zero operations but a
 * destination hash the live marker doesn't carry yet).
 */
function planRequiresExecution(entry: PerSpacePlan): boolean {
  if (entry.plan.operations.length > 0) return true;
  return entry.plan.origin?.storageHash !== entry.plan.destination.storageHash;
}

interface BuildSuccessArgs {
  readonly aggregate: ContractSpaceAggregate;
  readonly orderedResolutions: ReadonlyArray<{
    readonly spaceId: string;
    readonly entry: PerSpacePlan;
  }>;
  readonly perSpace: ReadonlyArray<PerSpaceExecutionEntry>;
  readonly totalOpsExecuted: number;
  readonly summary: string;
}

function buildSuccess(args: BuildSuccessArgs): MigrateSuccess {
  // The marker hash surfaced at the top level is the **app space's**
  // post-migrate marker (the top-level `markerHash` field).
  // Per-space markers live on `perSpace[].marker.storageHash`.
  const appResolution = args.orderedResolutions.find(
    (r) => r.spaceId === args.aggregate.app.spaceId,
  );
  const appMarkerHash =
    appResolution?.entry.plan.destination.storageHash ?? requireHeadRef(args.aggregate.app).hash;

  // Per-migration entries (one per authored edge) preserve the
  // `migrationsApplied` count semantics for back-compat with existing
  // JSON-shape consumers (e.g. `parsed.applied.length` in integration
  // tests). The aggregate per-space breakdown lives on `perSpace[]`.
  const applied = args.orderedResolutions.flatMap((r) => {
    const edges = r.entry.migrationEdges;
    return edges.map((edge) => ({
      spaceId: r.spaceId,
      dirName: edge.dirName,
      migrationHash: edge.migrationHash,
      from: edge.from,
      to: edge.to,
      operationsExecuted: edge.operationCount,
    }));
  });

  const appPlan = appResolution?.entry;
  const pathDecision: MigratePathDecision | undefined = appPlan?.pathDecision
    ? {
        fromHash: appPlan.pathDecision.fromHash,
        toHash: appPlan.pathDecision.toHash,
        alternativeCount: appPlan.pathDecision.alternativeCount,
        tieBreakReasons: appPlan.pathDecision.tieBreakReasons,
        ...(appPlan.pathDecision.refName !== undefined
          ? { refName: appPlan.pathDecision.refName }
          : {}),
        requiredInvariants: appPlan.pathDecision.requiredInvariants ?? [],
        satisfiedInvariants: appPlan.pathDecision.satisfiedInvariants ?? [],
        selectedPath: appPlan.pathDecision.selectedPath.map((entry) => ({
          dirName: entry.dirName,
          migrationHash: entry.migrationHash,
          from: entry.from,
          to: entry.to,
          invariants: entry.invariants,
        })),
      }
    : undefined;

  return {
    migrationsApplied: applied.length,
    markerHash: appMarkerHash,
    applied,
    summary: args.summary,
    perSpace: args.perSpace,
    ...(pathDecision !== undefined ? { pathDecision } : {}),
  };
}

/**
 * Build the `neverPlanned` failure raised when a contract space that
 * declares managed storage elements has no on-disk migration graph but
 * migrate was asked to reach a target hash. All-external spaces never reach
 * this: they resolve declaratively (marker advances to the head ref with
 * zero operations). The `why` states only the condition; the recovery
 * sequence is composed by `errorPathUnreachable`'s `fix`.
 *
 * @internal Exported for testing only.
 */
export function buildNeverPlannedFailure(
  spaceId: string,
  targetHash: string,
  migrationsDir: string,
): MigrateFailure {
  return {
    code: 'MIGRATION_PATH_NOT_FOUND',
    summary: `No on-disk migrations for contract space "${spaceId}"`,
    why: `migrate is replay-only: a contract space that declares managed storage elements must have an authored migration graph on disk. Space "${spaceId}" has no migrations under \`${migrationsDir}/${spaceId}/\` but its head ref targets "${targetHash}".`,
    meta: { spaceId, target: targetHash, kind: 'neverPlanned' },
  };
}

/**
 * Build the `pathUnreachable` failure raised when an emitted contract has no
 * on-disk migration edge from the current marker to the target. The `why`
 * states only the condition (no edge between the two named states, and migrate
 * replays edges rather than inventing them); the recovery sequence — plan the
 * edge, then re-apply — is composed by `errorPathUnreachable`'s `fix`, so the
 * two read as one non-redundant plan-then-apply story.
 *
 * @internal Exported for testing only.
 */
export function buildPathNotFoundFailure(
  spaceId: string,
  marker: ContractMarkerRecordLike | null,
  targetHash: string,
): MigrateFailure {
  const fromHash = marker?.storageHash ?? '<empty>';
  // The app-case phrasing names the user-visible condition (a
  // contract has been emitted that no on-disk migration reaches) so
  // the error reads naturally for the app space. Extension spaces
  // see the same condition expressed against the offending space.
  const summary =
    spaceId === 'app'
      ? 'Current contract has no planned migration path'
      : `Current contract has no planned migration path for contract space "${spaceId}"`;
  return {
    code: 'MIGRATION_PATH_NOT_FOUND',
    summary,
    why: `No migration edge connects the current state "${fromHash}" to the target "${targetHash}" in contract space "${spaceId}". The on-disk migration graph does not join the two, and migrate replays existing edges — it never invents one.`,
    meta: { spaceId, fromHash, targetHash, kind: 'pathUnreachable' },
  };
}
