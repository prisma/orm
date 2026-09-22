import type { Contract } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlannerResult,
  MigrationPlanWithAuthoringSurface,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createContractSpaceAggregate } from '../../src/aggregate/aggregate';
import { planMigration } from '../../src/aggregate/planner';
import type { AggregateContractSpace, ContractSpaceAggregate } from '../../src/aggregate/types';
import { EMPTY_CONTRACT_HASH } from '../../src/constants';
import type { OnDiskMigrationPackage } from '../../src/package';
import { createAttestedPackage, makeAggregateContractSpace } from '../fixtures';

const POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

function makeSpace(args: {
  spaceId: string;
  contract?: Contract;
  headRef?: { hash: string; invariants: readonly string[] };
  packages?: readonly OnDiskMigrationPackage[];
}): AggregateContractSpace {
  return makeAggregateContractSpace({
    spaceId: args.spaceId,
    contract: args.contract ?? createSqlContract({ target: 'postgres' }),
    headRef: args.headRef ?? { hash: EMPTY_CONTRACT_HASH, invariants: [] },
    packages: args.packages ?? [],
  });
}

function makeAggregate(args: {
  app: AggregateContractSpace;
  extensions?: AggregateContractSpace[];
  targetId?: string;
}): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: args.targetId ?? 'postgres',
    app: args.app,
    extensions: args.extensions ?? [],
    checkIntegrity: () => [],
  });
}

/**
 * Stub planner for `planFromDiff` paths. Configured per test to either
 * return a synthetic success plan or a failure with conflicts.
 */
function makeStubPlanner(outcome: MigrationPlannerResult): MigrationPlanner<'sql', 'postgres'> {
  return {
    plan: () => outcome,
    emptyMigration: () => {
      throw new Error('not used');
    },
  };
}

function makeStubMigrations(
  planner: MigrationPlanner<'sql', 'postgres'>,
): TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql', unknown>> {
  return {
    createPlanner: () => planner,
    createRunner: () => {
      throw new Error('runner not used by planner');
    },
    contractToSchema: () => ({ tables: {} }),
  };
}

const STUB_ADAPTER: ControlAdapterInstance<'sql', 'postgres'> =
  // The planner only forwards `adapter` to `migrations.createPlanner`
  // and never inspects fields on it. The cast is the minimum surface that
  // satisfies the generic.
  {} as unknown as ControlAdapterInstance<'sql', 'postgres'>;

function makeSyntheticPlan(targetId: string): MigrationPlanWithAuthoringSurface {
  return {
    targetId,
    origin: null,
    destination: { storageHash: 'synth-destination' },
    operations: [{ id: 'synth.op', label: 'Synthesised op', operationClass: 'additive' }],
    renderTypeScript: () => 'export {};',
  };
}

describe('planMigration', () => {
  it('selects plan-from-diff for the app space when callerPolicy.ignoreGraphFor includes its spaceId', async () => {
    const aggregate = makeAggregate({
      app: makeSpace({ spaceId: 'app' }),
    });
    const stubPlan = makeSyntheticPlan('placeholder-target-id-from-stub');
    const planner = makeStubPlanner({ kind: 'success', plan: stubPlan });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(true);
    const success = result.assertOk();
    expect(success.applyOrder).toEqual(['app']);
    expect(success.perSpace.get('app')?.strategy).toBe('plan-from-diff');
    // Aggregate planner overrides the family planner's targetId.
    expect(success.perSpace.get('app')?.plan.targetId).toBe('postgres');
  });

  it('resolves the recorded path for an extension space with a non-empty graph reaching its head ref', async () => {
    const headHash = 'cipher-head';
    const cipherPkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });
    const extension = makeSpace({
      spaceId: 'cipherstash',
      headRef: { hash: headHash, invariants: [] },
      packages: [cipherPkg],
    });
    const aggregate = makeAggregate({
      app: makeSpace({ spaceId: 'app' }),
      extensions: [extension],
    });

    const stubPlan = makeSyntheticPlan('postgres');
    const planner = makeStubPlanner({ kind: 'success', plan: stubPlan });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(true);
    const success = result.assertOk();
    // Extension first, then app — matches concatenateSpaceApplyInputs
    // ordering and preserves MigrationRunnerFailure.failingSpace.
    expect(success.applyOrder).toEqual(['cipherstash', 'app']);
    expect(success.perSpace.get('cipherstash')?.strategy).toBe('resolve-recorded-path');
    expect(success.perSpace.get('cipherstash')?.plan.destination.storageHash).toBe(headHash);
    expect(success.perSpace.get('cipherstash')?.plan.targetId).toBe('postgres');
    // App strategy is plan-from-diff per the caller policy.
    expect(success.perSpace.get('app')?.strategy).toBe('plan-from-diff');
  });

  it('declares the no-op state directly for an empty-graph space, never invoking the family planner', async () => {
    const extension = makeSpace({
      spaceId: 'cipherstash',
      headRef: { hash: EMPTY_CONTRACT_HASH, invariants: [] },
    });
    const aggregate = makeAggregate({
      app: makeSpace({ spaceId: 'app' }),
      extensions: [extension],
    });

    // Neither space is in `ignoreGraphFor` and neither has any packages, so
    // both take the empty-graph path — the strongest proof the family
    // planner is never reached for it.
    const planFn = vi.fn(
      (): MigrationPlannerResult => ({ kind: 'success', plan: makeSyntheticPlan('postgres') }),
    );
    const planner: MigrationPlanner<'sql', 'postgres'> = {
      plan: planFn,
      emptyMigration: () => {
        throw new Error('not used');
      },
    };

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set() },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(true);
    const success = result.assertOk();

    const cipherPlan = success.perSpace.get('cipherstash');
    expect(cipherPlan?.strategy).toBe('declared-state');
    expect(cipherPlan?.plan.operations).toEqual([]);
    expect(cipherPlan?.plan.destination.storageHash).toBe(EMPTY_CONTRACT_HASH);
    expect(cipherPlan?.plan.targetId).toBe('postgres');
    expect(cipherPlan?.migrationEdges).toEqual([
      {
        dirName: '',
        migrationHash: EMPTY_CONTRACT_HASH,
        from: '',
        to: EMPTY_CONTRACT_HASH,
        operationCount: 0,
      },
    ]);

    expect(success.perSpace.get('app')?.strategy).toBe('declared-state');
    expect(planFn).not.toHaveBeenCalled();
  });

  it('rejects with policyConflict when ignoreGraphFor covers a space that declares non-empty invariants', async () => {
    const extension = makeSpace({
      spaceId: 'cipherstash',
      headRef: { hash: EMPTY_CONTRACT_HASH, invariants: ['cipher:create-v1'] },
    });
    const aggregate = makeAggregate({
      app: makeSpace({ spaceId: 'app' }),
      extensions: [extension],
    });

    const planner = makeStubPlanner({
      kind: 'success',
      plan: makeSyntheticPlan('postgres'),
    });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      // ignoreGraphFor a space that requires resolving its recorded path —
      // that's a policy conflict.
      callerPolicy: { ignoreGraphFor: new Set(['app', 'cipherstash']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.kind).toBe('policyConflict');
    if (failure.kind !== 'policyConflict') return;
    expect(failure.spaceId).toBe('cipherstash');
    expect(failure.detail).toContain('cipher:create-v1');
  });

  it('rejects with extensionPathUnsatisfiable when the empty-graph space declares non-empty invariants', async () => {
    const extension = makeSpace({
      spaceId: 'cipherstash',
      headRef: { hash: EMPTY_CONTRACT_HASH, invariants: ['cipher:create-v1'] },
    });
    const aggregate = makeAggregate({
      app: makeSpace({ spaceId: 'app' }),
      extensions: [extension],
    });

    const planner = makeStubPlanner({
      kind: 'success',
      plan: makeSyntheticPlan('postgres'),
    });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      // Extension is not in ignoreGraphFor, but its graph is empty — an
      // empty graph can't satisfy its non-empty invariants.
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.kind).toBe('extensionPathUnsatisfiable');
    if (failure.kind !== 'extensionPathUnsatisfiable') return;
    expect(failure.spaceId).toBe('cipherstash');
    expect(failure.missingInvariants).toEqual(['cipher:create-v1']);
  });

  it('rejects with extensionPathUnreachable when an empty-graph space declares a managed element', async () => {
    // Advancing a marker without migrations (declared-state) is valid only
    // for an all-external space: nothing Prisma 8 owns exists there. An
    // extension that declares a managed element but ships no migrations is
    // an authoring bug and must fail loudly, not silently advance.
    const managedContract = createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: {
          __unbound__: {
            id: '__unbound__',
            entries: { table: { widget: {} } },
          },
        },
      },
    });
    const extension = makeSpace({
      spaceId: 'broken-extension',
      contract: managedContract,
      headRef: { hash: 'broken-extension-head', invariants: [] },
    });
    const aggregate = makeAggregate({
      app: makeSpace({ spaceId: 'app' }),
      extensions: [extension],
    });

    const planner = makeStubPlanner({
      kind: 'success',
      plan: makeSyntheticPlan('postgres'),
    });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure).toEqual({
      kind: 'extensionPathUnreachable',
      spaceId: 'broken-extension',
      target: 'broken-extension-head',
    });
  });

  it('declares the no-op state for an empty-graph space whose elements are all external', async () => {
    const externalContract = {
      ...createSqlContract({
        target: 'postgres',
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: { table: { platform_users: {} } },
            },
          },
        },
      }),
      defaultControlPolicy: 'external' as const,
    };
    const extension = makeSpace({
      spaceId: 'supabase-like',
      contract: externalContract,
      headRef: { hash: 'supabase-like-head', invariants: [] },
    });
    const aggregate = makeAggregate({
      app: makeSpace({ spaceId: 'app' }),
      extensions: [extension],
    });

    const planner = makeStubPlanner({
      kind: 'success',
      plan: makeSyntheticPlan('postgres'),
    });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(true);
    const success = result.assertOk();
    const plan = success.perSpace.get('supabase-like');
    expect(plan?.strategy).toBe('declared-state');
    expect(plan?.plan.operations).toEqual([]);
    expect(plan?.plan.destination.storageHash).toBe('supabase-like-head');
  });

  it('forwards plan-from-diff planner failures as planFromDiffFailed', async () => {
    const aggregate = makeAggregate({
      app: makeSpace({ spaceId: 'app' }),
    });
    const failingPlanner = makeStubPlanner({
      kind: 'failure',
      conflicts: [{ kind: 'typeMismatch', summary: 'incompatible column type' }],
    });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(failingPlanner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.kind).toBe('planFromDiffFailed');
    if (failure.kind !== 'planFromDiffFailed') return;
    expect(failure.spaceId).toBe('app');
    expect(failure.conflicts).toHaveLength(1);
  });
});
