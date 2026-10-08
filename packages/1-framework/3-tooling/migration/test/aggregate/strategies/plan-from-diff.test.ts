import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  SchemaOwnership,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { planFromDiff } from '../../../src/aggregate/strategies/plan-from-diff';
import type { AggregateContractSpace } from '../../../src/aggregate/types';
import { makeAggregateContractSpace } from '../../fixtures';

const POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

const STUB_ADAPTER: ControlAdapterInstance<'sql', 'postgres'> =
  {} as unknown as ControlAdapterInstance<'sql', 'postgres'>;

const STUB_OWNERSHIP: SchemaOwnership = { declaresEntity: () => false };

function makeSpace(spaceId: string, tables: Record<string, unknown>): AggregateContractSpace {
  return makeAggregateContractSpace({
    spaceId,
    contract: createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tables } },
        },
      },
    }),
  });
}

function makeStubPlan(targetId: string): MigrationPlanWithAuthoringSurface {
  return {
    targetId,
    origin: null,
    destination: { storageHash: 'synth' },
    operations: [{ id: 'synth.op', label: 'Synthesised op', operationClass: 'additive' }],
    renderTypeScript: () => 'export {};',
  };
}

describe('planFromDiff', () => {
  it('passes the full schema and the ownership oracle straight through to the planner', async () => {
    let observedSchema: unknown;
    let observedOwnership: SchemaOwnership | undefined;
    const stubPlanner: MigrationPlanner<'sql', 'postgres'> = {
      plan: ({ schema, ownership }) => {
        observedSchema = schema;
        observedOwnership = ownership;
        return { kind: 'success', plan: makeStubPlan('placeholder'), appliedStatements: [] };
      },
      emptyMigration: () => {
        throw new Error('not used');
      },
    };
    const stubMigrations: TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    > = {
      createPlanner: () => stubPlanner,
      createRunner: () => {
        throw new Error('runner not used');
      },
      contractToSchema: () => ({ tables: {} }),
    };

    const appSpace = makeSpace('app', { app_user: {} });

    const liveSchema = {
      tables: {
        app_user: { columns: { id: {} } },
        cipher_state: { columns: { id: {} } },
        orphan_table: { columns: {} },
      },
    };

    // The aggregate satisfies `SchemaOwnership`; the strategy forwards it
    // verbatim. Here `cipher_state` is owned by some (sibling) space.
    const ownership: SchemaOwnership = {
      declaresEntity: (coordinate) => coordinate.entityName === 'cipher_state',
    };

    const outcome = await planFromDiff({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      space: appSpace,
      ownership,
      schemaIntrospection: liveSchema,
      adapter: STUB_ADAPTER,
      migrations: stubMigrations,
      frameworkComponents: [],
      operationPolicy: POLICY,
      fromContract: null,
      statements: [],
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    // The strategy stamps the aggregate's targetId, not the planner's.
    expect(outcome.result.plan.targetId).toBe('postgres');
    expect(outcome.result.strategy).toBe('plan-from-diff');
    expect(outcome.result.migrationEdges).toEqual([
      {
        dirName: '',
        migrationHash: 'synth',
        from: '',
        to: 'synth',
        operationCount: 1,
        destinationContractJson: appSpace.contract(),
      },
    ]);

    // Critical: the planner saw the FULL schema (no pre-pruning) …
    const observed = observedSchema as { tables: Record<string, unknown> };
    expect(Object.keys(observed.tables).sort()).toEqual([
      'app_user',
      'cipher_state',
      'orphan_table',
    ]);

    // … and the same ownership oracle object. The planner asks it who owns
    // each extra; this strategy holds no ownership logic of its own.
    expect(observedOwnership).toBe(ownership);
  });

  it('hands the planner the origin contract and statements, and asks it for a plan with no origin', async () => {
    const appSpace = makeSpace('app', {});
    const fromContract = appSpace.contract();
    let received:
      | { fromContract: unknown; origin: unknown; statements: readonly unknown[] }
      | undefined;
    const stubPlanner: MigrationPlanner<'sql', 'postgres'> = {
      plan: (options) => {
        received = {
          fromContract: options.fromContract,
          origin: options.origin,
          statements: options.statements,
        };
        return {
          kind: 'success',
          plan: { ...makeStubPlan('placeholder'), origin: options.origin },
          appliedStatements: [],
        };
      },
      emptyMigration: () => {
        throw new Error('not used');
      },
    };
    const outcome = await planFromDiff({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      space: appSpace,
      ownership: STUB_OWNERSHIP,
      schemaIntrospection: { tables: {} },
      adapter: STUB_ADAPTER,
      migrations: {
        createPlanner: () => stubPlanner,
        createRunner: () => {
          throw new Error('runner not used');
        },
        contractToSchema: () => ({ tables: {} }),
      },
      frameworkComponents: [],
      operationPolicy: POLICY,
      fromContract,
      statements: [],
    });

    expect(received).toEqual({ fromContract, origin: null, statements: [] });
    expect(outcome.kind === 'ok' && outcome.result.plan.origin).toBeNull();
  });

  it('forwards planner failures verbatim', async () => {
    const stubPlanner: MigrationPlanner<'sql', 'postgres'> = {
      plan: () => ({
        kind: 'failure',
        conflicts: [{ kind: 'typeMismatch', summary: 'incompatible' }],
      }),
      emptyMigration: () => {
        throw new Error('not used');
      },
    };
    const stubMigrations: TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    > = {
      createPlanner: () => stubPlanner,
      createRunner: () => {
        throw new Error('runner not used');
      },
      contractToSchema: () => ({ tables: {} }),
    };

    const outcome = await planFromDiff({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      space: makeSpace('app', {}),
      ownership: STUB_OWNERSHIP,
      schemaIntrospection: { tables: {} },
      adapter: STUB_ADAPTER,
      migrations: stubMigrations,
      frameworkComponents: [],
      operationPolicy: POLICY,
      fromContract: null,
      statements: [],
    });

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(outcome.conflicts).toEqual([{ kind: 'typeMismatch', summary: 'incompatible' }]);
  });
});
