import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  DatabasePolicies,
  MigrationPlan,
  MigrationRunnerFailure,
  MigrationRunnerPerSpaceOptions,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import type {
  AggregateContractSpace,
  ContractSpaceAggregate,
  PerSpacePlan,
} from '@internal/migration-tools/aggregate';
import {
  buildFabricatedMigrationEdge,
  createContractSpaceAggregate,
} from '@internal/migration-tools/aggregate';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok } from '@internal/utils/result';
import { vi } from 'vitest';
import {
  collectOrdered,
  runMigration,
  runnerFailureFacts,
} from '../../src/control-api/operations/run-migration';

export const APP_HASH = `${'a'.repeat(64)}`;

function makeAppSpace(): AggregateContractSpace {
  const contract = {
    storage: { storageHash: APP_HASH, tables: {}, namespaces: {} },
  } as unknown as ReturnType<AggregateContractSpace['contract']>;
  return {
    spaceId: 'app',
    packages: [],
    refs: {},
    headRef: { hash: APP_HASH, invariants: [] },
    graph: () => ({
      nodes: new Set<string>([APP_HASH]),
      forwardChain: new Map(),
      reverseChain: new Map(),
      migrationByHash: new Map(),
    }),
    contract: () => contract,
    contractAt: vi.fn(),
  };
}

function makeAggregate(): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: 'postgres',
    app: makeAppSpace(),
    extensions: [],
    checkIntegrity: () => [],
  });
}

function makePerSpacePlan(): PerSpacePlan {
  const plan: MigrationPlan = {
    targetId: 'postgres',
    spaceId: 'app',
    origin: null,
    destination: { storageHash: APP_HASH },
    operations: [],
    providedInvariants: [],
  };
  return {
    plan,
    displayOps: [],
    destinationContract: makeAppSpace().contract,
    strategy: 'resolve-recorded-path',
    migrationEdges: [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: null,
        destinationStorageHash: APP_HASH,
        operationCount: 0,
      }),
    ],
    pathDecision: undefined,
  } as unknown as PerSpacePlan;
}

/** The failure `runMigration` returns when the runner of the one space, `app`, fails with `runnerFailure`. */
export async function runFailure(
  runnerFailure: MigrationRunnerFailure,
  origin: MigrationPlan['origin'] = null,
) {
  const failingResult: MigrationRunnerResult = notOk(runnerFailure);
  const migrations = {
    createRunner: () => ({ execute: async () => failingResult }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
  const result = await runMigration<'sql', 'postgres'>({
    aggregate: makeAggregate(),
    perSpacePlans: perSpacePlansFrom(origin),
    applyOrder: ['app'],
    driver: {} as ControlDriverInstance<'sql', 'postgres'>,
    familyInstance: { familyId: 'sql' } as unknown as ControlFamilyInstance<'sql', unknown>,
    migrations,
    frameworkComponents: [],
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    action: 'migrate',
  });
  return result.ok ? undefined : result.failure;
}

function perSpacePlansFrom(origin: MigrationPlan['origin']): ReadonlyMap<string, PerSpacePlan> {
  const perSpacePlan = makePerSpacePlan();
  return new Map([
    ['app', { ...perSpacePlan, plan: { ...perSpacePlan.plan, origin } } as unknown as PerSpacePlan],
  ]);
}

/** The facts the advice names when the runner of the one space, `app`, fails with `runnerFailure`. */
export async function failureOf(
  runnerFailure: MigrationRunnerFailure,
  origin: MigrationPlan['origin'],
) {
  const failure = await runFailure(runnerFailure, origin);
  return failure === undefined
    ? undefined
    : runnerFailureFacts(failure, collectOrdered(['app'], perSpacePlansFrom(origin)));
}

/** The per-space options `runMigration` hands the runner for the one space, `app`. */
export async function runnerOptionsFor(
  databasePolicies: DatabasePolicies | undefined,
): Promise<readonly MigrationRunnerPerSpaceOptions[]> {
  let captured: readonly MigrationRunnerPerSpaceOptions[] = [];
  const migrations = {
    createRunner: () => ({
      execute: async (options: {
        readonly perSpaceOptions: readonly MigrationRunnerPerSpaceOptions[];
      }) => {
        captured = options.perSpaceOptions;
        return ok({ perSpaceResults: [] });
      },
    }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
  await runMigration<'sql', 'postgres'>({
    aggregate: makeAggregate(),
    perSpacePlans: perSpacePlansFrom(null),
    applyOrder: ['app'],
    driver: {} as ControlDriverInstance<'sql', 'postgres'>,
    familyInstance: { familyId: 'sql' } as unknown as ControlFamilyInstance<'sql', unknown>,
    migrations,
    frameworkComponents: [],
    policy: { allowedOperationClasses: ['additive'] },
    action: 'migrate',
    ...ifDefined('databasePolicies', databasePolicies),
  });
  return captured;
}
