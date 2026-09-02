import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import type { SnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import { ifDefined } from '@internal/utils/defined';
import { notOk } from '@internal/utils/result';
import type { DbUpdateResult, OnControlProgress } from '../types';
import { executeRun } from './db-run';
import { computePlanHash } from './plan-identity';

const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
} as const;

/**
 * Options for the `db update` operation.
 *
 * Same loader → planner → runner pipeline as `db init`, but with the
 * widened operation policy (additive + widening + destructive). The
 * destructive-change confirmation gate runs at this layer: when
 * `mode === 'apply'` and `acceptDataLoss` is `false`, the operation
 * pre-plans, surfaces destructive ops to the caller, and aborts.
 */
export interface ExecuteDbUpdateOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly contract: Contract;
  readonly mode: 'plan' | 'apply';
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly acceptDataLoss?: boolean;
  /**
   * Consent to the plan a prior `DESTRUCTIVE_CHANGES` refusal named by its
   * `planHash`. The apply recomputes its plan and refuses with
   * `CONSENT_PLAN_MISMATCH` when the fresh plan differs.
   */
  readonly consent?: { readonly planHash: string };
  readonly migrationsDir: string;
  readonly targetId: TTargetId;
  readonly extensions?: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  /** Content check for contract snapshots the aggregate loader resolves. */
  readonly verifySnapshotContent?: SnapshotContentVerifier;
  readonly onProgress?: OnControlProgress;
}

/**
 * Execute `db update` against the configured contract.
 *
 * Routes through the loader → planner → runner pipeline. Destructive
 * operations require either `acceptDataLoss: true` or a prior
 * `mode: 'plan'` invocation that surfaces the destructive ops; the
 * confirmation gate is implemented here so the lower-level applier
 * remains policy-agnostic.
 */
export async function executeDbUpdate<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbUpdateOptions<TFamilyId, TTargetId>,
): Promise<DbUpdateResult> {
  const sharedInputs = {
    driver: options.driver,
    adapter: options.adapter,
    familyInstance: options.familyInstance,
    contract: options.contract,
    migrations: options.migrations,
    frameworkComponents: options.frameworkComponents,
    migrationsDir: options.migrationsDir,
    targetId: options.targetId,
    extensions: options.extensions ?? [],
    policy: DB_UPDATE_POLICY,
    action: 'dbUpdate' as const,
    ...ifDefined('verifySnapshotContent', options.verifySnapshotContent),
    ...ifDefined('onProgress', options.onProgress),
  };
  if (options.mode === 'apply' && !options.acceptDataLoss && options.consent === undefined) {
    const refusal = await guardDestructiveChanges<TFamilyId, TTargetId>(sharedInputs);
    if (refusal !== null) return refusal;
  }
  return (await executeRun<TFamilyId, TTargetId>({
    ...sharedInputs,
    mode: options.mode,
    ...ifDefined('consentedPlanHash', options.consent?.planHash),
  })) as DbUpdateResult;
}

/**
 * Pre-plan once when running `db update apply` without `acceptDataLoss`.
 * Surfaces destructive operations across every space; if any are
 * planned, returns a `DESTRUCTIVE_CHANGES` failure that the CLI shows
 * as a confirmation prompt. Returns `null` when the apply is safe to
 * run.
 */
async function guardDestructiveChanges<TFamilyId extends string, TTargetId extends string>(
  sharedInputs: Omit<Parameters<typeof executeRun<TFamilyId, TTargetId>>[0], 'mode'>,
): Promise<DbUpdateResult | null> {
  const planResult = (await executeRun<TFamilyId, TTargetId>({
    ...sharedInputs,
    mode: 'plan',
  })) as DbUpdateResult;
  if (!planResult.ok) return planResult;
  const destructiveOps = planResult.value.plan.operations
    .filter((op) => op.operationClass === 'destructive')
    .map((op) => ({ id: op.id, label: op.label }));
  if (destructiveOps.length === 0) return null;
  const databaseName = await sharedInputs.driver.databaseName?.();
  return notOk({
    code: 'DESTRUCTIVE_CHANGES',
    summary: `Planned ${destructiveOps.length} destructive operation(s) that require confirmation`,
    why: 'Destructive operations require explicit consent, which the caller has not given',
    conflicts: undefined,
    meta: undefined,
    destructiveChanges: {
      destructiveOperations: destructiveOps,
      databaseName,
      planHash: computePlanHash({
        operations: planResult.value.plan.operations,
        destination: planResult.value.destination,
      }),
    },
    ...ifDefined('warnings', planResult.value.warnings),
  });
}
