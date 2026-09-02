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
import type { DbInitResult, OnControlProgress } from '../types';
import { executeRun } from './db-run';

/**
 * Options for executing the `db init` operation.
 *
 * `db init` runs the loader → planner → runner pipeline:
 *
 * 1. {@link executeRun} loads a `ContractSpaceAggregate` via
 *    {@link import('@internal/migration-tools/aggregate').loadContractSpaceAggregate}
 *    from the supplied descriptor set + on-disk on-disk artefacts.
 * 2. The aggregate planner runs with `callerPolicy.ignoreGraphFor`
 *    locked to the app space — synth strategy for the app, graph-walk
 *    for every extension.
 * 3. The runner's `execute` applies the per-space plans
 *    inside one outer transaction.
 *
 * `extensions` mirrors `Config.extensions` (descriptor list).
 * The loader (sub-spec § Loader) is the sole descriptor-import boundary.
 */
export interface ExecuteDbInitOptions<TFamilyId extends string, TTargetId extends string> {
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
  /**
   * On-disk migrations directory the aggregate loader reads on-disk
   * artefacts from. Required.
   */
  readonly migrationsDir: string;
  /**
   * Resolved adapter target id. Threaded through to the loader for
   * target-consistency checks across descriptors and the app contract.
   */
  readonly targetId: TTargetId;
  /**
   * Declared extension descriptors. Defaults to an empty list, which
   * routes through the same loader → planner → runner pipeline with no
   * extension spaces in the aggregate.
   */
  readonly extensions?: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  /** Content check for contract snapshots the aggregate loader resolves. */
  readonly verifySnapshotContent?: SnapshotContentVerifier;
  /** Optional progress callback for observing operation progress */
  readonly onProgress?: OnControlProgress;
}

/**
 * Execute `db init` against the configured contract.
 *
 * Routes through the loader → planner → runner pipeline (sub-spec
 * "Commit-by-commit § Commit 4"). Always additive-only; destructive
 * changes belong to `db update`.
 */
export async function executeDbInit<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbInitOptions<TFamilyId, TTargetId>,
): Promise<DbInitResult> {
  const result = await executeRun<TFamilyId, TTargetId>({
    driver: options.driver,
    adapter: options.adapter,
    familyInstance: options.familyInstance,
    contract: options.contract,
    mode: options.mode,
    migrations: options.migrations,
    frameworkComponents: options.frameworkComponents,
    migrationsDir: options.migrationsDir,
    targetId: options.targetId,
    extensions: options.extensions ?? [],
    policy: { allowedOperationClasses: ['additive'] },
    action: 'dbInit',
    ...ifDefined('verifySnapshotContent', options.verifySnapshotContent),
    ...ifDefined('onProgress', options.onProgress),
  });
  return result as DbInitResult;
}
