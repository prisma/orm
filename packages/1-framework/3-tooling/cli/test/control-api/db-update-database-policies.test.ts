import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import type { PlanQuestion } from '../../src/control-api/statements/plan-questions';
import type { TargetRef } from '../../src/control-api/types';

const TEST_INVOCATION = { cwd: '/work/app', configPath: undefined, dbGiven: false };

const FAKE_MIGRATIONS_DIR = '/tmp/__test-db-update-migrations';

const noQuestions = async (questions: readonly PlanQuestion[]) =>
  questions.map((question) => ({ verb: 'delete' as const, text: question.subject }));

function markerRecord(meta: Record<string, unknown>): ContractMarkerRecord {
  return {
    storageHash: 'origin',
    profileHash: '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta,
    invariants: [],
  };
}

function createMockDriver() {
  return {
    close: vi.fn(),
    databaseName: async () => 'appdb',
  } as unknown as ControlDriverInstance<'sql', 'postgres'>;
}

const STUB_ADAPTER = {} as unknown as ControlAdapterInstance<'sql', 'postgres'>;

function createMockFamilyInstance(overrides?: {
  readAllMarkers?: () => Promise<ReadonlyMap<string, ContractMarkerRecord>>;
  introspect?: () => Promise<unknown>;
}) {
  return {
    familyId: 'sql',
    markerLocation: 'prisma_contract.marker',
    readAllMarkers: overrides?.readAllMarkers ?? (async () => new Map()),
    introspect: overrides?.introspect ?? (async () => ({ tables: {} })),
    deserializeContract: (ir: unknown) => ir as Contract,
    // Stub `OperationPreviewCapable` so the plan path produces an empty
    // preview when no operations carry SQL execute steps.
    toOperationPreview: () => ({ statements: [] }),
  } as unknown as ControlFamilyInstance<'sql', unknown>;
}

function createMockMigrations(overrides?: {
  planResult?: MigrationPlannerResult;
  runnerResult?: MigrationRunnerResult;
  executeSpy?: ReturnType<typeof vi.fn>;
}) {
  const planResult: MigrationPlannerResult = overrides?.planResult ?? {
    kind: 'success',
    dataLoss: [],
    accessChanges: [],
    temporaryValues: [],
    appliedStatements: [],
    plan: {
      targetId: 'postgres',
      destination: { storageHash: 'new-hash', profileHash: 'new-profile' },
      operations: [
        {
          id: 'column.user.nickname',
          label: 'Add column nickname on user',
          operationClass: 'additive',
        },
      ],
      renderTypeScript: () => {
        throw new Error('not used in db update tests');
      },
    },
  };

  const opsExecuted = overrides?.runnerResult ?? null;
  const runnerResult: MigrationRunnerResult =
    opsExecuted ??
    ok({
      perSpaceResults: [
        {
          space: 'app',
          value: {
            operationsPlanned:
              planResult.kind === 'success' ? planResult.plan.operations.length : 0,
            operationsExecuted:
              planResult.kind === 'success' ? planResult.plan.operations.length : 0,
          },
        },
      ],
    });

  const execute = overrides?.executeSpy ?? vi.fn().mockResolvedValue(runnerResult);

  return {
    createPlanner: () => ({
      plan: vi.fn().mockReturnValue(planResult),
    }),
    createRunner: () => ({
      execute,
    }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
}

const dummyContract = {
  schemaVersion: '1',
  target: 'postgres',
  storage: { storageHash: 'dummy', tables: {}, namespaces: {} },
} as unknown as Contract;

const MIGRATE_ONLY = { policies: { change: ['migrate'] } };

function update(args: {
  readonly mode: 'plan' | 'apply';
  readonly markers: ReadonlyMap<string, ContractMarkerRecord>;
  readonly ref?: TargetRef;
  readonly permitPolicyChange?: boolean;
  readonly executeSpy?: ReturnType<typeof vi.fn>;
}) {
  return executeDbUpdate({
    invocation: TEST_INVOCATION,
    driver: createMockDriver(),
    adapter: STUB_ADAPTER,
    familyInstance: createMockFamilyInstance({ readAllMarkers: async () => args.markers }),
    contract: dummyContract,
    mode: args.mode,
    migrations: createMockMigrations(
      args.executeSpy === undefined ? undefined : { executeSpy: args.executeSpy },
    ),
    frameworkComponents: [],
    migrationsDir: FAKE_MIGRATIONS_DIR,
    answerQuestions: noQuestions,
    targetId: 'postgres',
    ...(args.ref === undefined ? {} : { ref: args.ref }),
    ...(args.permitPolicyChange === undefined
      ? {}
      : { permitPolicyChange: args.permitPolicyChange }),
  });
}

const RECOVERY = 'Author a migration with {bin} migration plan, then deploy it.';

describe('executeDbUpdate, database policies', () => {
  it.each(['plan', 'apply'] as const)(
    'refuses a database that changes only through migrations, in %s mode, before it plans',
    async (mode) => {
      const execute = vi.fn();
      const result = await update({
        mode,
        markers: new Map([['app', markerRecord(MIGRATE_ONLY)]]),
        executeSpy: execute,
      });

      expect(result.ok ? undefined : result.failure.toEnvelope()).toEqual({
        ok: false,
        code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
        severity: 'error',
        summary: "This database's change policy permits only migrations",
        why: 'The marker records change: migrate, so db update may not move it.',
        fix: RECOVERY,
        nextActions: [{ kind: 'user-choice', label: RECOVERY }],
        meta: { spaceId: 'app', command: 'db update', change: ['migrate'] },
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('refuses a ref whose policies differ without consent', async () => {
    const result = await update({
      mode: 'plan',
      markers: new Map(),
      ref: { name: 'dev', hash: 'dummy', invariants: [], policies: { change: ['reconcile'] } },
    });

    expect(result.ok ? undefined : result.failure.toEnvelope()).toMatchObject({
      code: 'MIGRATION.POLICY_MISMATCH',
      meta: {
        spaceId: 'app',
        refName: 'dev',
        differences: [
          { setting: 'change', declared: ['reconcile'], inForce: ['migrate', 'reconcile'] },
        ],
      },
    });
  });

  it('with consent, records the ref overlaid on the policies in force', async () => {
    const execute = vi.fn().mockResolvedValue(
      ok({
        perSpaceResults: [{ space: 'app', value: { operationsPlanned: 1, operationsExecuted: 1 } }],
      }),
    );
    const result = await update({
      mode: 'apply',
      markers: new Map(),
      ref: {
        name: 'dev',
        hash: 'dummy',
        invariants: [],
        policies: { dataProtection: { dataLoss: 'data-loss-permitted' } },
      },
      permitPolicyChange: true,
      executeSpy: execute,
    });

    expect(result.ok ? result.value.summary : result.failure).toBe(
      'Applied 1 operation(s) across 1 space(s), signature updated; policies updated: dataLoss: data-loss-permitted',
    );
    expect(execute.mock.calls[0]?.[0].perSpaceOptions[0].databasePolicies).toEqual({
      change: ['migrate', 'reconcile'],
      dataProtection: {
        dataLoss: 'data-loss-permitted',
        accessWidening: 'access-widening-with-consent',
      },
    });
  });

  it('records no policies when a run gives none', async () => {
    const execute = vi.fn().mockResolvedValue(
      ok({
        perSpaceResults: [{ space: 'app', value: { operationsPlanned: 1, operationsExecuted: 1 } }],
      }),
    );
    await update({ mode: 'apply', markers: new Map(), executeSpy: execute });

    expect(execute.mock.calls[0]?.[0].perSpaceOptions[0]).not.toHaveProperty('databasePolicies');
  });
});
