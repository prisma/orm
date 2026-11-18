import { asNamespaceId } from '@internal/contract/types';
import {
  type ControlDriverInstance,
  type ControlFamilyInstance,
  type MigrationPlan,
  type MigrationRunnerResult,
  migrationRunnerFailure,
  type TargetMigrationsCapability,
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
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it, vi } from 'vitest';
import {
  collectOrdered,
  type RunAction,
  runMigration,
  runnerFailureFacts,
} from '../../src/control-api/operations/run-migration';
import type { ControlProgressEvent } from '../../src/control-api/types';

const APP_HASH = `${'a'.repeat(64)}`;

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

function makeMigrations(): TargetMigrationsCapability<
  'sql',
  'postgres',
  ControlFamilyInstance<'sql', unknown>
> {
  const runnerResult: MigrationRunnerResult = ok({
    perSpaceResults: [{ space: 'app', value: { operationsPlanned: 0, operationsExecuted: 0 } }],
  });
  return {
    createRunner: () => ({
      execute: async () => runnerResult,
    }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
}

async function runWithAction(action: RunAction): Promise<ControlProgressEvent[]> {
  const events: ControlProgressEvent[] = [];
  const aggregate = makeAggregate();
  const perSpacePlans = new Map([['app', makePerSpacePlan()]]);

  await runMigration<'sql', 'postgres'>({
    aggregate,
    perSpacePlans,
    applyOrder: ['app'],
    driver: {} as ControlDriverInstance<'sql', 'postgres'>,
    familyInstance: { familyId: 'sql' } as unknown as ControlFamilyInstance<'sql', unknown>,
    migrations: makeMigrations(),
    frameworkComponents: [],
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    action,
    onProgress: (event) => events.push(event),
  });
  return events;
}

describe('runMigration apply span label', () => {
  it('emits the `dbInit` label for action=dbInit', async () => {
    const events = await runWithAction('dbInit');
    const start = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
    expect(start).toMatchObject({
      action: 'dbInit',
      label: 'Initialising database across spaces',
    });
  });

  it('emits the `dbUpdate` label for action=dbUpdate', async () => {
    const events = await runWithAction('dbUpdate');
    const start = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
    expect(start).toMatchObject({
      action: 'dbUpdate',
      label: 'Updating database across spaces',
    });
  });

  it('emits the `migrate` label for action=migrate', async () => {
    const events = await runWithAction('migrate');
    const start = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
    expect(start).toMatchObject({
      action: 'migrate',
      label: 'Running migration plan across spaces',
    });
  });
});

describe('runMigration, a runner failure', () => {
  it('returns the runner failure object itself', async () => {
    const runnerFailure = migrationRunnerFailure(
      'MIGRATION.EXECUTION_FAILED',
      'relation "users" already exists',
      {
        why: 'CREATE TABLE users conflicted with an existing relation',
        meta: { sqlState: '42P07', failingSpace: 'app' },
      },
    );
    const failingResult: MigrationRunnerResult = notOk(runnerFailure);
    const migrations = {
      createRunner: () => ({
        execute: async () => failingResult,
      }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >;

    const result = await runMigration<'sql', 'postgres'>({
      aggregate: makeAggregate(),
      perSpacePlans: new Map([['app', makePerSpacePlan()]]),
      applyOrder: ['app'],
      driver: {} as ControlDriverInstance<'sql', 'postgres'>,
      familyInstance: { familyId: 'sql' } as unknown as ControlFamilyInstance<'sql', unknown>,
      migrations,
      frameworkComponents: [],
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
      action: 'migrate',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toBe(runnerFailure);
  });
});

describe('runMigration, a type change that failed', () => {
  it('names the field as a convert statement names it, and the migration of the failed operation', async () => {
    const failingResult: MigrationRunnerResult = notOk(
      migrationRunnerFailure(
        'MIGRATION.EXECUTION_FAILED',
        'Operation alterType.user.age failed during execution: alter type of "age"',
        {
          meta: {
            failingSpace: 'app',
            failedTypeChange: {
              field: {
                kind: 'field',
                namespaceId: asNamespaceId('app'),
                model: 'User',
                field: 'age',
              },
              by: 'cast',
              reason: 'value',
              operationIndex: 2,
            },
          },
        },
      ),
    );
    const migrations = {
      createRunner: () => ({ execute: async () => failingResult }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >;
    const edge = (dirName: string, from: string, operationCount: number) => ({
      migrationHash: `sha256:${dirName}`,
      dirName,
      from,
      to: `${from}-next`,
      operationCount,
    });
    const migrationEdges = [
      edge('first', 'h0', 2),
      edge('second', 'h1', 1),
      edge('third', 'h2', 1),
    ];
    const destinationContract = { domain: { namespaces: { app: { models: {} } } } };

    const perSpacePlans = new Map([
      [
        'app',
        { ...makePerSpacePlan(), destinationContract, migrationEdges } as unknown as PerSpacePlan,
      ],
    ]);
    const result = await runMigration<'sql', 'postgres'>({
      aggregate: makeAggregate(),
      perSpacePlans,
      applyOrder: ['app'],
      driver: {} as ControlDriverInstance<'sql', 'postgres'>,
      familyInstance: { familyId: 'sql' } as unknown as ControlFamilyInstance<'sql', unknown>,
      migrations,
      frameworkComponents: [],
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
      action: 'migrate',
    });

    const facts = result.ok
      ? undefined
      : runnerFailureFacts(result.failure, collectOrdered(['app'], perSpacePlans));
    expect(
      facts === undefined
        ? undefined
        : { failedTypeChange: facts.failedTypeChange, failedMigration: facts.failedMigration },
    ).toEqual({
      failedTypeChange: { field: 'User.age', by: 'cast', reason: 'value' },
      failedMigration: { spaceId: 'app', edge: migrationEdges[1] },
    });
  });
});

describe('runnerFailureFacts, rows that hold a removed stored value', () => {
  it('reports each enum value, its stored value and the rows, with the migration of the failed operation, the first', () => {
    const migrationEdges = [
      { migrationHash: 'sha256:first', dirName: 'first', from: 'h0', to: 'h1', operationCount: 2 },
      {
        migrationHash: 'sha256:second',
        dirName: 'second',
        from: 'h1',
        to: 'h2',
        operationCount: 1,
      },
    ];
    const perSpacePlans = new Map([
      [
        'app',
        {
          ...makePerSpacePlan(),
          destinationContract: { domain: { namespaces: { app: { models: {} } } } },
          migrationEdges,
        } as unknown as PerSpacePlan,
      ],
    ]);
    const failure = migrationRunnerFailure('MIGRATION.PRECHECK_FAILED', 'rows hold it', {
      meta: {
        failingSpace: 'app',
        rowsHoldingValue: [
          {
            enumValue: { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'ARCHIVED' },
            value: 'archived',
            rows: 2,
            operationIndex: 2,
            keepDataEdit: { remove: 'this.remove()', replaceWith: 'this.replace()' },
          },
          {
            enumValue: { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'ARCHIVED' },
            value: 'archived',
            rows: 5,
            operationIndex: 0,
          },
        ],
      },
    });

    const facts = runnerFailureFacts(failure, collectOrdered(['app'], perSpacePlans));

    expect({
      rowsHoldingValue: facts.rowsHoldingValue,
      failedMigration: facts.failedMigration,
    }).toEqual({
      rowsHoldingValue: [
        {
          enumValue: 'Status.ARCHIVED',
          enumName: 'Status',
          value: 'archived',
          rows: 2,
          keepDataEdit: { remove: 'this.remove()', replaceWith: 'this.replace()' },
        },
        { enumValue: 'Status.ARCHIVED', enumName: 'Status', value: 'archived', rows: 5 },
      ],
      failedMigration: { spaceId: 'app', edge: migrationEdges[1] },
    });
  });
});
