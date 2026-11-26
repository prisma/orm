import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ContractSpace,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationRunnerFailure,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';
import type { Result } from '@internal/utils/result';
import { notOk, ok } from '@internal/utils/result';
import { resolveRecordedPath } from './aggregate/strategies/resolve-recorded-path';
import { errorInstalledSpaceUnreachable } from './errors';
import { verifyMigrationHash } from './hash';
import { reconstructGraph } from './migration-graph';

/**
 * A space's own migrations decide what they may change; the user's policies do not govern them.
 */
const EVERY_OPERATION_CLASS: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

export interface ApplyInstalledContractSpaceInputs<
  TFamilyId extends string,
  TTargetId extends string,
> {
  readonly spaceId: string;
  /** The space as an installed package carries it, such as a target descriptor's `contractSpace`. */
  readonly contractSpace: ContractSpace;
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId, unknown>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
}

export interface InstalledContractSpaceApplied {
  /**
   * `applied`: the runner ran the path to the head. `atHead`: the space's row already recorded the head. `ahead`: the row records a contract these migrations never reach, and the space's ledger shows the database passed through the head, so a later release brought it further; within a major version that release only added, so nothing is applied.
   */
  readonly outcome: 'applied' | 'atHead' | 'ahead';
  readonly operationsExecuted: number;
}

/**
 * Brings a contract space that an installed package carries up to date: reads the space's own marker row, and when it does not record the space's head, applies the path from it to the head with the target's runner, in one call for this space alone. Reads nothing from the user's repository. A database without the marker table reads as having no row, so the path then starts from the empty contract.
 *
 * Throws when a migration in the space does not match its hash or no path covers the head's invariants, which are faults of the package, and `MIGRATION.INSTALLED_SPACE_UNREACHABLE` when the row records a contract the space's migrations never pass through and the space's ledger never recorded the head. When the ledger did record the head, the database is ahead of this release and nothing is applied. Returns the runner's failure unchanged.
 */
export async function applyInstalledContractSpace<
  TFamilyId extends string,
  TTargetId extends string,
>(
  inputs: ApplyInstalledContractSpaceInputs<TFamilyId, TTargetId>,
): Promise<Result<InstalledContractSpaceApplied, MigrationRunnerFailure>> {
  const { spaceId, contractSpace, driver, familyInstance } = inputs;
  const { headRef, migrations: packages } = contractSpace;

  const marker = await familyInstance.readMarker({ driver, space: spaceId });
  if (
    marker !== null &&
    marker.storageHash === headRef.hash &&
    headRef.invariants.every((invariant) => marker.invariants.includes(invariant))
  ) {
    return ok({ outcome: 'atHead', operationsExecuted: 0 });
  }

  for (const pkg of packages) {
    if (!verifyMigrationHash(pkg).ok) {
      throw new InternalError(
        `Migration "${pkg.dirName}" of the installed contract space "${spaceId}" does not match its migrationHash.`,
      );
    }
  }

  const graph = reconstructGraph(packages);
  if (marker !== null && !graph.nodes.has(marker.storageHash)) {
    const ledger = await familyInstance.readLedger({ driver, space: spaceId });
    if (ledger.some((entry) => entry.to === headRef.hash)) {
      return ok({ outcome: 'ahead', operationsExecuted: 0 });
    }
    throw errorInstalledSpaceUnreachable({
      spaceId,
      markerHash: marker.storageHash,
      headRefHash: headRef.hash,
    });
  }
  const outcome = resolveRecordedPath({
    aggregateTargetId: driver.targetId,
    space: {
      spaceId,
      packages,
      headRef,
      graph: () => graph,
      contract: () => familyInstance.deserializeContract(contractSpace.contractJson),
    },
    currentMarker: marker,
    storageNameOf: (operation) => familyInstance.storageNameOf(operation),
    accessChangesOf: (operations) => familyInstance.accessChangesOf(operations),
  });
  if (outcome.kind === 'unreachable') {
    if (marker === null) {
      throw new InternalError(
        `The installed contract space "${spaceId}" does not lead from the empty contract to its head ${headRef.hash}.`,
      );
    }
    throw errorInstalledSpaceUnreachable({
      spaceId,
      markerHash: marker.storageHash,
      headRefHash: headRef.hash,
    });
  }
  if (outcome.kind === 'unsatisfiable') {
    throw new InternalError(
      `No path through the installed contract space "${spaceId}" provides the invariants ${outcome.missing.join(', ')}.`,
    );
  }

  const { plan, destinationContract, migrationEdges } = outcome.result;
  const runner = inputs.migrations.createRunner(familyInstance);
  const result = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: spaceId,
        plan,
        driver,
        destinationContract,
        policy: EVERY_OPERATION_CLASS,
        frameworkComponents: inputs.frameworkComponents,
        migrationEdges,
        strictVerification: false,
      },
    ],
  });
  if (!result.ok) return notOk(result.failure);
  const operationsExecuted = result.value.perSpaceResults.reduce(
    (sum, spaceResult) => sum + spaceResult.value.operationsExecuted,
    0,
  );
  return ok({ outcome: 'applied', operationsExecuted });
}
