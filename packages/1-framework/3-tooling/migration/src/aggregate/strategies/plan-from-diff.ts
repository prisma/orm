import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlannerResult,
  ResolvedMigrationStatement,
  SchemaOwnership,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '../fabricated-migration-edge';
import type { ContractMarkerRecordLike } from '../marker-types';
import type { PerSpacePlan } from '../planner-types';
import type { AggregateContractSpace } from '../types';

export interface PlanFromDiffInputs<TFamilyId extends string, TTargetId extends string> {
  readonly aggregateTargetId: string;
  readonly currentMarker: ContractMarkerRecordLike | null;
  readonly space: AggregateContractSpace;
  /**
   * Ownership oracle over the whole composition — the passive aggregate
   * itself. Handed straight through to the family planner, which asks it,
   * per live extra node, whether any space owns that entity; a sibling-owned
   * node is left untouched, an unowned node is a genuine extra. This strategy
   * runs no diff of its own and holds no ownership logic — it forwards the
   * aggregate as the oracle.
   */
  readonly ownership: SchemaOwnership;
  readonly schemaIntrospection: unknown;
  readonly adapter: ControlAdapterInstance<TFamilyId, TTargetId>;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly operationPolicy: MigrationOperationPolicy;
  /** The contract the database is at, when the caller knows it. */
  readonly fromContract: Contract | null;
  readonly statements: readonly ResolvedMigrationStatement[];
}

export type PlanFromDiffOutcome =
  | { readonly kind: 'ok'; readonly result: PerSpacePlan }
  | { readonly kind: 'failure'; readonly conflicts: readonly MigrationPlannerConflict[] };

/**
 * The {@link MigrationPlanner.plan} interface is declared as synchronous,
 * but historical and test fixture call sites have always invoked it
 * with `await` (see prior `db-apply-per-space.ts`). Tolerating a
 * Promise here keeps existing test mocks working without changing the
 * declared family SPI.
 */
type MaybeAsyncPlannerResult = MigrationPlannerResult | Promise<MigrationPlannerResult>;

/**
 * Plan a migration for a single contract space from a diff against the full
 * live schema, delegating to the family's `createPlanner(...).plan(...)`.
 *
 * The planner diffs the whole introspected schema, so it sees other contract
 * spaces' tables as "extras"; the orchestration hands the planner the
 * aggregate as an ownership oracle so it can ask, per extra, whether any
 * space owns it — a sibling-owned table is left untouched, so the planner
 * never emits a destructive drop for it, and this strategy holds no ownership
 * logic of its own. The schema is never pruned before planning: cross-space
 * foreign keys need every sibling table visible to the diff.
 *
 * The produced plan's `targetId` is set from `aggregateTargetId`
 * (the aggregate's ambient target). The family's planner does not
 * stamp `targetId` on the produced plan; the aggregate planner is
 * the single point that knows the target.
 *
 * Used by:
 *
 * - The app space by default (CLI policy
 *   `ignoreGraphFor: { app.spaceId }`).
 * - Any extension space whose `headRef.invariants` is empty and whose
 *   graph is non-empty (the all-external, zero-migration-package case is
 *   handled directly by the aggregate planner without calling this).
 */
export async function planFromDiff<TFamilyId extends string, TTargetId extends string>(
  input: PlanFromDiffInputs<TFamilyId, TTargetId>,
): Promise<PlanFromDiffOutcome> {
  const planner = input.migrations.createPlanner(input.adapter);
  const plannerResult: MigrationPlannerResult = await (planner.plan({
    contract: input.space.contract(),
    schema: input.schemaIntrospection,
    policy: input.operationPolicy,
    fromContract: input.fromContract,
    origin: null,
    statements: input.statements,
    frameworkComponents: input.frameworkComponents,
    spaceId: input.space.spaceId,
    ownership: input.ownership,
    // This plan is wrapped as a plain `MigrationPlan` below (no authoring
    // surface) and applied directly — `renderTypeScript()` is never called
    // for a diff-fabricated reconciliation plan, so there is no migration
    // package dir to compute a real snapshots import path from.
    snapshotsImportPath: '',
  }) as MaybeAsyncPlannerResult);

  if (plannerResult.kind === 'failure') {
    return { kind: 'failure', conflicts: plannerResult.conflicts };
  }

  const producedPlan = plannerResult.plan;
  // The family planner returns a class-instance-shaped plan whose
  // `destination` / `operations` are accessors on the prototype, often
  // backed by private fields. A naive spread (`{ ...producedPlan }`)
  // would lose those accessors and produce a plan with
  // `destination: undefined`; rebinding the prototype on a plain
  // object would break private-field access. We instead wrap the plan
  // in a Proxy that forwards every read except `targetId`, which is
  // stamped from the aggregate's ambient target. This preserves the
  // planner's class semantics while keeping the aggregate the single
  // source of truth for `targetId`.
  const plan: MigrationPlan = new Proxy(producedPlan, {
    get(target, prop) {
      if (prop === 'targetId') return input.aggregateTargetId;
      // Forward `this` as the original target so prototype-bound
      // private fields (#destination, #operations, …) resolve.
      return Reflect.get(target, prop, target);
    },
    has(target, prop) {
      if (prop === 'targetId') return true;
      return Reflect.has(target, prop);
    },
  });

  const destinationStorageHash = producedPlan.destination.storageHash;
  const producedOps = await Promise.all(producedPlan.operations);
  const destinationContract = input.space.contract();
  return {
    kind: 'ok',
    result: {
      plan,
      displayOps: producedOps,
      destinationContract,
      strategy: 'plan-from-diff',
      appliedStatements: plannerResult.appliedStatements,
      dataLoss: plannerResult.dataLoss,
      accessWidening: plannerResult.accessWidening,
      ...(plannerResult.warnings && plannerResult.warnings.length > 0
        ? { warnings: plannerResult.warnings }
        : {}),
      migrationEdges: [
        buildFabricatedMigrationEdge({
          currentMarkerStorageHash: input.currentMarker?.storageHash,
          destinationStorageHash,
          operationCount: producedOps.length,
          destinationContractJson: destinationContract,
        }),
      ],
    },
  };
}
