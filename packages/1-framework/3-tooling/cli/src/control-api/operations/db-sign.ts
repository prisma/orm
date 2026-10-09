import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  MarkerHashes,
  SpaceSignature,
  SpaceToSign,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import {
  type AggregateContractSpace,
  type ContractSpaceAggregate,
  collectAggregateNamespaces,
  spacesInApplyOrder,
  verifyMigration,
} from '@internal/migration-tools/aggregate';
import type { SnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { CliStructuredError } from '../../utils/cli-errors';
import type { OnControlProgress } from '../types';
import { buildContractSpaceAggregate } from './contract-space-aggregate-loader';
import { runIntrospection } from './db-verify';

export interface ExecuteDbSignOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  /** The app space's contract, already deserialized. */
  readonly contract: Contract;
  readonly migrationsDir: string;
  readonly targetId: TTargetId;
  readonly extensions: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly verifySnapshotContent?: SnapshotContentVerifier;
  readonly onProgress?: OnControlProgress;
}

/** A space `db sign` did not sign because the live schema does not satisfy its contract; its marker is left as it was. */
export interface DbSignSpaceFailure {
  readonly space: string;
  readonly status: 'failed';
  readonly contract: MarkerHashes;
  readonly schema: VerifyDatabaseSchemaResult;
}

/**
 * What `db sign` did with one contract space: what the family's signing did to its marker ({@link SpaceSignature}), or `failed` when the live schema does not satisfy the space's contract.
 */
export type DbSignSpaceOutcome = SpaceSignature | DbSignSpaceFailure;

export interface ExecuteDbSignSuccess {
  /** The app space first, then each extension space in declaration order. */
  readonly spaces: readonly DbSignSpaceOutcome[];
}

export type ExecuteDbSignResult = Result<ExecuteDbSignSuccess, CliStructuredError>;

/**
 * Loads the contract-space aggregate and signs it with {@link signContractSpaces}.
 */
export async function executeDbSign<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbSignOptions<TFamilyId, TTargetId>,
): Promise<ExecuteDbSignResult> {
  const { familyInstance } = options;
  const loaded = await buildContractSpaceAggregate({
    targetId: options.targetId,
    migrationsDir: options.migrationsDir,
    appContract: options.contract,
    extensions: options.extensions,
    deserializeContract: (json) => familyInstance.deserializeContract(json),
    ...ifDefined('verifySnapshotContent', options.verifySnapshotContent),
  });
  if (!loaded.ok) return notOk(loaded.failure);
  return signContractSpaces({
    driver: options.driver,
    familyInstance,
    aggregate: loaded.value,
    frameworkComponents: options.frameworkComponents,
    ...ifDefined('onProgress', options.onProgress),
  });
}

export interface SignContractSpacesOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly aggregate: ContractSpaceAggregate;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly onProgress?: OnControlProgress;
}

function markerHashes(marker: ContractMarkerRecord | undefined): MarkerHashes | null {
  return marker === undefined
    ? null
    : { storageHash: marker.storageHash, profileHash: marker.profileHash };
}

/**
 * Reads every space's marker, verifies every contract space of the aggregate against the live schema without strict mode, then writes the marker of every space that verified in one call to the family, each only while it still holds the hashes read here. A space that fails verification is reported with its schema result and keeps its marker; a space whose marker another process wrote in the meantime is reported as a conflict and keeps that marker. The family gets the spaces in the order `migrate` applies them ({@link spacesInApplyOrder}).
 */
export async function signContractSpaces<TFamilyId extends string, TTargetId extends string>(
  options: SignContractSpacesOptions<TFamilyId, TTargetId>,
): Promise<ExecuteDbSignResult> {
  const { driver, familyInstance, aggregate, frameworkComponents, onProgress } = options;
  const markers = await familyInstance.readAllMarkers({ driver });

  const schemaIntrospection = await runIntrospection({
    action: 'dbSign',
    driver,
    familyInstance,
    onProgress,
    contract: collectAggregateNamespaces(aggregate),
  });
  const verified = verifyMigration({
    aggregate,
    markersBySpaceId: markers,
    schemaIntrospection,
    mode: 'lenient',
    verifySchemaForSpace: (schema, space) =>
      familyInstance.verifySchema({
        contract: space.contract(),
        schema,
        strict: false,
        frameworkComponents,
      }),
  });
  if (!verified.ok) {
    return notOk(
      new CliStructuredError('MIGRATION.CONTRACT_SPACE_VIOLATION', 'Aggregate verifier failed', {
        why: verified.failure.detail,
        fix: 'Check database connectivity and the introspection tooling.',
        docsUrl: 'https://pris.ly/contract-spaces',
      }),
    );
  }

  const schemaOf = (space: AggregateContractSpace): VerifyDatabaseSchemaResult => {
    const schema = verified.value.schemaCheck.perSpace.get(space.spaceId);
    if (schema === undefined) {
      throw new InternalError(
        `the aggregate verifier returned no schema result for contract space "${space.spaceId}"`,
      );
    }
    return schema;
  };
  const toSign: readonly SpaceToSign[] = spacesInApplyOrder(aggregate)
    .filter((space) => schemaOf(space).ok)
    .map((space) => ({
      space: space.spaceId,
      contract: space.contract(),
      expected: markerHashes(markers.get(space.spaceId)),
    }));

  onProgress?.({ action: 'dbSign', kind: 'spanStart', spanId: 'sign', label: 'Signing database' });
  const signatures = await familyInstance.signSpaces({ driver, spaces: toSign });
  onProgress?.({ action: 'dbSign', kind: 'spanEnd', spanId: 'sign', outcome: 'ok' });
  const signatureOf = new Map(signatures.map((signature) => [signature.space, signature]));

  return ok({
    spaces: [aggregate.app, ...aggregate.extensions].map((space): DbSignSpaceOutcome => {
      const contract = space.contract();
      return (
        signatureOf.get(space.spaceId) ?? {
          space: space.spaceId,
          status: 'failed',
          contract: {
            storageHash: contract.storage.storageHash,
            profileHash: contract.profileHash,
          },
          schema: schemaOf(space),
        }
      );
    }),
  });
}
