import type { Contract } from '@internal/contract/types';
import type {
  MongoControlFamilyInstance,
  MongoControlTargetDescriptor,
} from '@internal/family-mongo/control';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import type {
  MongoControlAdapter,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import type {
  MigrationRunner,
  MigrationRunnerPerSpaceSuccessValue,
  MigrationRunnerResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import type { MongoContract } from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok } from '@internal/utils/result';
import { mongoTargetDescriptorMeta } from '../descriptor-meta';
import type { MongoTargetContract } from '../mongo-target-contract';
import { MongoTargetContractSerializer } from '../mongo-target-contract-serializer';
import { MongoMigrationPlanner } from './mongo-planner';
import { MongoMigrationRunner, type MongoMigrationRunnerExecuteOptions } from './mongo-runner';
import { MongoTargetSchemaVerifier } from './mongo-target-schema-verifier';
import { entityNamesDeclaredBy, scopeVerifyResultToSpace } from './scope-verify-result';

export type { MongoControlTargetDescriptor };

/**
 * `migration.ts` default-exports a `Migration` subclass whose `operations`
 * getter returns the ordered list of operations and whose `describe()`
 * returns the manifest identity metadata. `MongoMigrationPlanner.plan()`
 * returns a `MigrationPlanWithAuthoringSurface` that knows how to render
 * itself back to such a file; `MongoMigrationPlanner.emptyMigration()`
 * returns the same shape for `migration new`. Users run the scaffolded
 * `migration.ts` directly (via `node migration.ts`) to self-emit
 * `ops.json` and attest the `migrationHash`.
 */
export const mongoTargetDescriptor: MongoControlTargetDescriptor<MongoTargetContract> = {
  ...mongoTargetDescriptorMeta,
  contractSerializer: new MongoTargetContractSerializer(),
  schemaVerifier: new MongoTargetSchemaVerifier(),
  migrations: {
    createPlanner(_adapter: MongoControlAdapter<'mongo'>) {
      return new MongoMigrationPlanner();
    },
    createRunner(family: MongoControlFamilyInstance) {
      // Deps are bound to the first driver passed to execute() and cached for
      // subsequent calls. Callers must not change the driver between calls.
      let cachedDeps: MongoRunnerDependencies | undefined;

      const runMongo = async (
        driver: Parameters<MigrationRunner<'mongo', 'mongo'>['execute']>[0]['driver'],
        runnerOptions: Omit<MongoMigrationRunnerExecuteOptions, 'destinationContract'> & {
          readonly destinationContract: unknown;
        },
      ) => {
        cachedDeps ??= family.createRunnerDependencies({ driver });
        // The framework `MigrationRunner` interface types `destinationContract`
        // as `unknown`; the Mongo runner narrows to `MongoContract`. Validation
        // happens upstream — `migrate` calls
        // `familyInstance.deserializeContract(contract)` on the project-root
        // contract loaded from disk before routing it here, so this cast
        // preserves the framework signature without weakening the runner's
        // typed surface.
        return new MongoMigrationRunner(cachedDeps).execute({
          ...runnerOptions,
          destinationContract: blindCast<
            MongoContract,
            'framework MigrationRunner types destinationContract as unknown; deserializeContract validated it upstream'
          >(runnerOptions.destinationContract),
        });
      };

      const runner: MigrationRunner<'mongo', 'mongo'> = {
        // Mongo cannot wrap DDL ops in a session transaction (createCollection,
        // createIndex, collMod, setValidation all bypass transactions even on
        // replica sets), so the cross-space envelope is *resumable* rather than
        // transactional. Per-space-internal verify-gated marker atomicity
        // already lives in `MongoMigrationRunner.execute`: ops apply, schema is
        // introspected and verified, and the marker advances only on verify-pass.
        // This loop composes that guarantee across spaces — earlier-advanced
        // markers are not rolled back when a later space fails. Re-running reads
        // each marker, finds spaces 1..N−1 at-head (no-op skip), retries N onward.
        //
        // Per-space verify is scoped by `scopeVerifyResultToSpace`: the live DB
        // holds collections owned by sibling contract spaces, so each space
        // verifies the full schema and then drops the `extra` findings for the
        // collections a sibling space claims. Without the scoping an aggregate
        // of two spaces could not pass strict verify (every other-space
        // collection would look like an extra).
        //
        // See `docs/architecture docs/subsystems/10. MongoDB Family.md` §
        // Contract spaces and ADR 212 — Contract spaces.
        async execute({ driver, perSpaceOptions }): Promise<MigrationRunnerResult> {
          const contracts = perSpaceOptions.map((opts) =>
            blindCast<Contract, 'destinationContract validated at aggregate boundary'>(
              opts.destinationContract,
            ),
          );
          const perSpaceResults: Array<{
            space: string;
            value: MigrationRunnerPerSpaceSuccessValue;
          }> = [];
          for (let i = 0; i < perSpaceOptions.length; i++) {
            const spaceOptions = perSpaceOptions[i];
            if (!spaceOptions) continue;
            // The runner verifies the destination contract against the full
            // introspected schema; scope the result to this space, dropping the
            // `extra` findings for collections a sibling space claims.
            const ownedByOtherSpaces = entityNamesDeclaredBy(contracts.filter((_, j) => j !== i));
            const scopeVerifyResult = (
              result: VerifyDatabaseSchemaResult,
            ): VerifyDatabaseSchemaResult => scopeVerifyResultToSpace(result, ownedByOtherSpaces);
            const { space, ...runnerOptions } = spaceOptions;
            const result = await runMongo(driver, { ...runnerOptions, scopeVerifyResult });
            if (!result.ok) {
              return notOk({
                ...result.failure,
                failingSpace: space,
              });
            }
            perSpaceResults.push({ space, value: result.value });
          }
          return ok({ perSpaceResults });
        },
      };
      return runner;
    },
    contractToSchema(contract: Contract | null) {
      return contractToMongoSchemaIR(
        blindCast<
          MongoContract | null,
          'framework contractToSchema types contract as the generic Contract; any contract reaching the mongo target is MongoContract by construction'
        >(contract),
      );
    },
  },
  create() {
    return { familyId: 'mongo' as const, targetId: 'mongo' as const };
  },
};
