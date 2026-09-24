import type { Contract, ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlStack,
  CoreSchemaView,
  MigrationPlanOperation,
  OperationPreview,
  OperationPreviewCapable,
  SchemaViewCapable,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import {
  APP_SPACE_ID,
  VERIFY_CODE_HASH_MISMATCH,
  VERIFY_CODE_MARKER_MISSING,
  VERIFY_CODE_TARGET_MISMATCH,
} from '@internal/framework-components/control';
import { assertDescriptorSelfConsistency } from '@internal/migration-tools/spaces';
import type { MongoContract } from '@internal/mongo-contract';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import type {
  MongoControlAdapter,
  MongoControlAdapterDescriptor,
  MongoRunnerDependencies,
} from './control-adapter';
import type { MongoControlExtensionDescriptor } from './control-types';
import { MongoContractSerializer } from './ir/mongo-contract-serializer';
import { mongoOperationsToPreview } from './operation-preview';
import { mongoSchemaToView } from './schema-to-view';
import { verifyMongoSchema } from './schema-verify/verify-mongo-schema';

export interface MongoControlFamilyInstance
  extends ControlFamilyInstance<'mongo', MongoSchemaIR>,
    SchemaViewCapable<MongoSchemaIR>,
    OperationPreviewCapable {
  /**
   * The family seam-of-record for on-disk contract reads. Structurally
   * validates the JSON envelope, then casts to the framework `Contract`
   * shape; the per-target serializer (held on the Mongo target
   * descriptor) does the class-form wrap for downstream consumers, so
   * the family only needs the validated data. The single named entry
   * point every CLI on-disk read crosses (TML-2536) — `as Contract`
   * casts in production package sources are a serializer-bypass smell
   * guarded by `pnpm lint:no-contract-cast`.
   */
  deserializeContract(contractJson: unknown): Contract;

  /**
   * Builds the migration runner's dependencies through the control adapter on the stack, so the target never names the adapter package (ADR 198).
   */
  createRunnerDependencies(options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
  }): MongoRunnerDependencies;
}

function deserializeMongoContract(contractJson: unknown): MongoContract {
  // Structural validation only — the per-target serializer wraps the
  // result in a class-form `MongoTargetContract` for downstream
  // consumers (CLI, runner). The family-instance methods only read
  // hash/target fields off the validated shape, so the unwrapped
  // `MongoContract` is sufficient here and avoids a family→target
  // runtime dep.
  return new MongoContractSerializer().deserializeContract(contractJson);
}

/**
 * Family-method contract input. By the time control-plane methods
 * (`verify`, `verifySchema`, `sign`, …) are invoked through the CLI
 * control client (`client.ts`), the input has already been threaded
 * through `familyInstance.deserializeContract`. The value is therefore a
 * class-form `MongoTargetContract` (or a structurally-equivalent
 * envelope post-deserialization) and must NOT be re-fed through
 * structural validation (arktype rejects extra keys like `namespaces`).
 *
 * The parameter type on the framework SPI is `unknown` for variance
 * reasons (so the family can express its own contract type without
 * leaking it to the framework). This helper recovers the validated
 * shape with a single narrow cast.
 */
function asValidatedMongoContract(contract: unknown): MongoContract {
  return contract as MongoContract;
}

function buildVerifyResult(opts: {
  ok: boolean;
  code?: string;
  summary: string;
  contractStorageHash: string;
  contractProfileHash?: string;
  marker?: ContractMarkerRecord;
  expectedTargetId: string;
  actualTargetId?: string;
  contractPath: string;
  configPath?: string;
  totalTime: number;
}): VerifyDatabaseResult {
  return {
    ok: opts.ok,
    ...ifDefined('code', opts.code),
    summary: opts.summary,
    contract: {
      storageHash: opts.contractStorageHash,
      ...ifDefined('profileHash', opts.contractProfileHash),
    },
    ...ifDefined(
      'marker',
      opts.marker
        ? { storageHash: opts.marker.storageHash, profileHash: opts.marker.profileHash }
        : undefined,
    ),
    target: {
      expected: opts.expectedTargetId,
      ...ifDefined('actual', opts.actualTargetId),
    },
    meta: {
      contractPath: opts.contractPath,
      ...ifDefined('configPath', opts.configPath),
    },
    timings: { total: opts.totalTime },
  };
}

export function createMongoFamilyInstance(controlStack: ControlStack): MongoControlFamilyInstance {
  // Descriptor self-consistency check.
  // Each extension that exposes a `contractSpace` must publish a
  // `headRef.hash` that matches the canonical hash recomputed from its
  // `contractJson`. A stale value would silently corrupt every downstream
  // boundary that trusts `headRef.hash` as the canonical identity (drift
  // detection, on-disk artefact emission, runner marker writes). Failing
  // fast at descriptor-load time turns "extension author shipped an
  // inconsistent descriptor" into an explicit, actionable error
  // (`MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH`) rather than a confusing
  // mismatch surfacing several layers downstream. Mirrors the SQL family.
  const extensions = (controlStack.extensions ?? []) as readonly MongoControlExtensionDescriptor[];
  for (const extension of extensions) {
    if (extension.contractSpace) {
      const { contractJson, headRef } = extension.contractSpace;
      assertDescriptorSelfConsistency({
        extensionId: extension.id,
        target: contractJson.target,
        targetFamily: contractJson.targetFamily,
        storage: contractJson.storage,
        headRefHash: headRef.hash,
        ...mongoContractCanonicalizationHooks,
      });
    }
  }

  // Mongo dispatch surface. Every wire-level operation routes through
  // the adapter resolved from the control stack; the family carries no
  // direct imports of target/adapter/driver internals. Mirrors the SQL
  // family's `getControlAdapter()` helper.
  const adapter = controlStack.adapter as MongoControlAdapterDescriptor<'mongo'> | undefined;
  const getControlAdapter = (): MongoControlAdapter<'mongo'> => {
    if (!adapter) {
      throw new InternalError('Mongo family requires an adapter descriptor in ControlStack');
    }
    return adapter.create(controlStack as ControlStack<'mongo', 'mongo'>);
  };

  // The family-level driver type is `ControlDriverInstance<'mongo', string>`,
  // but the SPI methods are typed against `<'mongo', 'mongo'>`. A type predicate
  // narrows safely based on targetId rather than casting. The family layer cannot
  // import the adapter's MongoControlDriverInstance (targets domain), so this
  // predicate returns the framework type only. The adapter's isMongoControlDriver
  // predicate handles transport-bearing narrowing (MongoControlDriverInstance with
  // .db and .execute).
  function isMongoTargetDriver(
    driver: ControlDriverInstance<'mongo', string>,
  ): driver is ControlDriverInstance<'mongo', 'mongo'> {
    return driver.targetId === 'mongo';
  }

  function asMongoDriver(
    driver: ControlDriverInstance<'mongo', string>,
  ): ControlDriverInstance<'mongo', 'mongo'> {
    if (!isMongoTargetDriver(driver)) {
      throw structuredError(
        'CONTRACT.TARGET_MISMATCH',
        `Expected Mongo control driver with targetId 'mongo', got '${driver.targetId}'`,
      );
    }
    return driver;
  }

  return {
    familyId: 'mongo' as const,

    deserializeContract(contractJson: unknown): Contract {
      // The deserialized class form (MongoTargetContract, owned by
      // target-mongo) and the framework Contract are structurally
      // compatible — same fields, just a class instance on the storage
      // envelope. The cast preserves the framework signature.
      return deserializeMongoContract(contractJson) as unknown as Contract;
    },

    async verify(options): Promise<VerifyDatabaseResult> {
      const { driver, contract: rawContract, expectedTargetId, contractPath, configPath } = options;
      const startTime = Date.now();

      const contract = asValidatedMongoContract(rawContract);

      const contractStorageHash = contract.storage.storageHash;
      const contractProfileHash = contract.profileHash;
      const contractTarget = contract.target;

      const baseOpts = {
        contractStorageHash,
        contractProfileHash,
        expectedTargetId,
        contractPath,
        ...ifDefined('configPath', configPath),
      };

      if (contractTarget !== expectedTargetId) {
        return buildVerifyResult({
          ...baseOpts,
          ok: false,
          code: VERIFY_CODE_TARGET_MISMATCH,
          summary: 'Target mismatch',
          actualTargetId: contractTarget,
          totalTime: Date.now() - startTime,
        });
      }

      const marker = await getControlAdapter().readMarker(asMongoDriver(driver), APP_SPACE_ID);

      if (!marker) {
        return buildVerifyResult({
          ...baseOpts,
          ok: false,
          code: VERIFY_CODE_MARKER_MISSING,
          summary: 'Marker missing',
          totalTime: Date.now() - startTime,
        });
      }

      if (marker.storageHash !== contractStorageHash) {
        return buildVerifyResult({
          ...baseOpts,
          ok: false,
          code: VERIFY_CODE_HASH_MISMATCH,
          summary: 'Hash mismatch',
          marker,
          totalTime: Date.now() - startTime,
        });
      }

      if (contractProfileHash && marker.profileHash !== contractProfileHash) {
        return buildVerifyResult({
          ...baseOpts,
          ok: false,
          code: VERIFY_CODE_HASH_MISMATCH,
          summary: 'Hash mismatch',
          marker,
          totalTime: Date.now() - startTime,
        });
      }

      return buildVerifyResult({
        ...baseOpts,
        ok: true,
        summary: 'Database matches contract',
        marker,
        totalTime: Date.now() - startTime,
      });
    },

    verifySchema(options: {
      readonly contract: unknown;
      readonly schema: MongoSchemaIR;
      readonly strict: boolean;
      readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', string>>;
    }): VerifyDatabaseSchemaResult {
      const contract = asValidatedMongoContract(options.contract);
      return verifyMongoSchema({
        contract,
        schema: options.schema,
        strict: options.strict,
        frameworkComponents: options.frameworkComponents,
      });
    },

    async sign(options): Promise<SignDatabaseResult> {
      const { driver, contract: rawContract, contractPath, configPath } = options;
      const startTime = Date.now();

      const contract = asValidatedMongoContract(rawContract);

      const contractStorageHash = contract.storage.storageHash;
      const contractProfileHash = contract.profileHash;

      const controlAdapter = getControlAdapter();
      const mongoDriver = asMongoDriver(driver);

      const existingMarker = await controlAdapter.readMarker(mongoDriver, APP_SPACE_ID);

      let markerCreated = false;
      let markerUpdated = false;
      let previousHashes: { storageHash?: string; profileHash?: string } | undefined;

      if (!existingMarker) {
        await controlAdapter.initMarker(mongoDriver, APP_SPACE_ID, {
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
        });
        markerCreated = true;
      } else {
        const storageHashMatches = existingMarker.storageHash === contractStorageHash;
        const profileHashMatches = existingMarker.profileHash === contractProfileHash;

        if (!storageHashMatches || !profileHashMatches) {
          previousHashes = {
            storageHash: existingMarker.storageHash,
            profileHash: existingMarker.profileHash,
          };
          const updated = await controlAdapter.updateMarker(
            mongoDriver,
            APP_SPACE_ID,
            existingMarker.storageHash,
            {
              storageHash: contractStorageHash,
              profileHash: contractProfileHash,
            },
          );
          if (!updated) {
            throw structuredError(
              'MIGRATION.MARKER_CAS_FAILURE',
              'CAS conflict: marker was modified by another process during sign',
            );
          }
          markerUpdated = true;
        }
      }

      let summary: string;
      if (markerCreated) {
        summary = 'Database signed (marker created)';
      } else if (markerUpdated) {
        summary = `Database signed (marker updated from ${previousHashes?.storageHash ?? 'unknown'})`;
      } else {
        summary = 'Database already signed with this contract';
      }

      return {
        ok: true,
        summary,
        contract: {
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
        },
        target: {
          expected: contract.target,
          actual: contract.target,
        },
        marker: {
          created: markerCreated,
          updated: markerUpdated,
          ...ifDefined('previous', previousHashes),
        },
        meta: {
          contractPath,
          ...ifDefined('configPath', configPath),
        },
        timings: {
          total: Date.now() - startTime,
        },
      };
    },

    async readMarker(options): Promise<ContractMarkerRecord | null> {
      return getControlAdapter().readMarker(asMongoDriver(options.driver), options.space);
    },

    async readAllMarkers(options): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
      return getControlAdapter().readAllMarkers(asMongoDriver(options.driver));
    },

    async readLedger(options): Promise<readonly LedgerEntryRecord[]> {
      return getControlAdapter().readLedger(asMongoDriver(options.driver), options.space);
    },

    async introspect(options): Promise<MongoSchemaIR> {
      return getControlAdapter().introspectSchema(asMongoDriver(options.driver));
    },

    createRunnerDependencies(options): MongoRunnerDependencies {
      return getControlAdapter().createRunnerDependencies(asMongoDriver(options.driver));
    },

    toSchemaView(schema: MongoSchemaIR): CoreSchemaView {
      return mongoSchemaToView(schema);
    },

    toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview {
      return mongoOperationsToPreview(operations);
    },
  };
}
