import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import type { ControlProgressEvent } from '../../src/control-api/types';

const FAKE_MIGRATIONS_DIR = '/tmp/__test-db-update-migrations';

function markerRecord(fields: {
  readonly storageHash: string;
  readonly profileHash?: string;
}): ContractMarkerRecord {
  return {
    storageHash: fields.storageHash,
    profileHash: fields.profileHash ?? '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: {},
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

describe('executeDbUpdate', () => {
  it('succeeds on a fresh database without marker', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance(),
      contract: dummyContract,
      mode: 'plan',
      migrations: createMockMigrations(),
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('plan');
      expect(result.value.plan.operations).toHaveLength(1);
    }
  });

  it('returns PLANNING_FAILED when planner reports conflicts', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance({
        readAllMarkers: async () => new Map([['app', markerRecord({ storageHash: 'origin' })]]),
      }),
      contract: dummyContract,
      mode: 'plan',
      migrations: createMockMigrations({
        planResult: {
          kind: 'failure',
          conflicts: [
            {
              kind: 'typeMismatch',
              summary: 'Type mismatch',
            },
          ],
        },
      }),
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('PLANNING_FAILED');
      expect(result.failure.conflicts).toHaveLength(1);
      expect(result.failure.conflicts?.[0]).toMatchObject({ kind: 'typeMismatch' });
    }
  });

  it('returns plan result without invoking runner in plan mode', async () => {
    const execute = vi.fn();
    const migrations = createMockMigrations({
      planResult: {
        kind: 'success',
        appliedStatements: [],
        plan: {
          targetId: 'postgres',
          destination: { storageHash: 'dest', profileHash: 'dest-profile' },
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
      },
      executeSpy: execute,
    });

    const result = await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance({
        readAllMarkers: async () =>
          new Map([
            [
              'app',
              markerRecord({
                storageHash: 'origin',
                profileHash: 'origin-profile',
              }),
            ],
          ]),
      }),
      contract: dummyContract,
      mode: 'plan',
      migrations,
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('plan');
      expect(result.value.plan.operations).toHaveLength(1);
      expect(result.value.plan.preview).toEqual({ statements: [] });
      expect(result.value.destination.storageHash).toBe('dest');
      expect(result.value.execution).toBeUndefined();
      expect(result.value.marker).toBeUndefined();
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns RUNNER_FAILED when runner rejects apply', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance({
        readAllMarkers: async () => new Map([['app', markerRecord({ storageHash: 'origin' })]]),
      }),
      contract: dummyContract,
      mode: 'apply',
      acceptDataLoss: true,
      migrations: createMockMigrations({
        runnerResult: notOk({
          code: 'ORIGIN_MISMATCH',
          summary: 'Origin mismatch',
          why: 'Marker drifted',
          meta: { drift: true },
          failingSpace: 'app',
        }),
      }),
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('RUNNER_FAILED');
      expect(result.failure.summary).toBe('Origin mismatch');
      expect(result.failure.why).toBe('Marker drifted');
      expect(result.failure.meta).toMatchObject({ drift: true, failingSpace: 'app' });
    }
  });

  it('returns success with execution stats and marker in apply mode', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance({
        readAllMarkers: async () =>
          new Map([
            [
              'app',
              markerRecord({
                storageHash: 'origin',
                profileHash: 'origin-profile',
              }),
            ],
          ]),
      }),
      contract: dummyContract,
      mode: 'apply',
      acceptDataLoss: true,
      migrations: createMockMigrations({
        runnerResult: ok({
          perSpaceResults: [
            { space: 'app', value: { operationsPlanned: 2, operationsExecuted: 2 } },
          ],
        }),
      }),
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('apply');
      expect(result.value.execution).toMatchObject({
        operationsPlanned: 2,
        operationsExecuted: 2,
      });
      expect(result.value.marker).toBeDefined();
      expect(result.value.marker?.storageHash).toBe('new-hash');
      expect(result.value.summary).toContain('Applied');
    }
  });

  it('returns success with 0 operations when database already matches contract', async () => {
    const result = await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance({
        readAllMarkers: async () =>
          new Map([
            [
              'app',
              markerRecord({
                storageHash: 'current',
                profileHash: 'current-profile',
              }),
            ],
          ]),
      }),
      contract: dummyContract,
      mode: 'apply',
      migrations: createMockMigrations({
        planResult: {
          kind: 'success',
          appliedStatements: [],
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'current', profileHash: 'current-profile' },
            operations: [],
            renderTypeScript: () => {
              throw new Error('not used in db update tests');
            },
          },
        },
        runnerResult: ok({
          perSpaceResults: [
            { space: 'app', value: { operationsPlanned: 0, operationsExecuted: 0 } },
          ],
        }),
      }),
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('apply');
      expect(result.value.plan.operations).toHaveLength(0);
      expect(result.value.execution).toMatchObject({
        operationsPlanned: 0,
        operationsExecuted: 0,
      });
      expect(result.value.destination.storageHash).toBe('current');
      expect(result.value.summary).toContain('already matches');
    }
  });

  it('returns plan with 0 operations when database already matches contract in plan mode', async () => {
    const execute = vi.fn();
    const migrations = createMockMigrations({
      planResult: {
        kind: 'success',
        appliedStatements: [],
        plan: {
          targetId: 'postgres',
          destination: { storageHash: 'same', profileHash: 'same-profile' },
          operations: [],
          renderTypeScript: () => {
            throw new Error('not used in db update tests');
          },
        },
      },
      executeSpy: execute,
    });

    const result = await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance({
        readAllMarkers: async () =>
          new Map([
            [
              'app',
              markerRecord({
                storageHash: 'same',
                profileHash: 'same-profile',
              }),
            ],
          ]),
      }),
      contract: dummyContract,
      mode: 'plan',
      migrations,
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('plan');
      expect(result.value.plan.operations).toHaveLength(0);
      expect(result.value.summary).toContain('Planned 0');
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows additive, widening, and destructive operation classes', async () => {
    const planFn = vi.fn().mockReturnValue({
      kind: 'success',
      appliedStatements: [],
      plan: {
        targetId: 'postgres',
        destination: { storageHash: 'dest' },
        operations: [],
      },
    });

    const migrations = {
      createPlanner: () => ({ plan: planFn }),
      createRunner: () => ({
        execute: vi.fn().mockResolvedValue(
          ok({
            perSpaceResults: [
              { space: 'app', value: { operationsPlanned: 0, operationsExecuted: 0 } },
            ],
          }),
        ),
      }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >;

    await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance({
        readAllMarkers: async () => new Map([['app', markerRecord({ storageHash: 'origin' })]]),
      }),
      contract: dummyContract,
      mode: 'plan',
      migrations,
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(planFn).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
        // `db update` reconciles against the live introspected schema and has
        // structural representation of "no origin contract" (AC-5).
      }),
    );
  });

  describe('destructive changes gate', () => {
    function createDestructiveMigrations() {
      return createMockMigrations({
        planResult: {
          kind: 'success',
          appliedStatements: [],
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'dest' },
            operations: [
              {
                id: 'dropColumn.user.nickname',
                label: 'Drop column nickname from user',
                operationClass: 'destructive',
              },
              {
                id: 'column.user.bio',
                label: 'Add column bio to user',
                operationClass: 'additive',
              },
            ],
            renderTypeScript: () => {
              throw new Error('not used in db update tests');
            },
          },
        },
        runnerResult: ok({
          perSpaceResults: [
            { space: 'app', value: { operationsPlanned: 2, operationsExecuted: 2 } },
          ],
        }),
      });
    }

    it('returns DESTRUCTIVE_CHANGES in apply mode without acceptDataLoss', async () => {
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance({
          readAllMarkers: async () => new Map([['app', markerRecord({ storageHash: 'origin' })]]),
        }),
        contract: dummyContract,
        mode: 'apply',
        migrations: createDestructiveMigrations(),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('DESTRUCTIVE_CHANGES');
        expect(result.failure.summary).toContain('destructive');
        expect(result.failure.destructiveChanges).toEqual({
          destructiveOperations: [
            { id: 'dropColumn.user.nickname', label: 'Drop column nickname from user' },
          ],
          databaseName: 'appdb',
          planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
      }
    });

    it('applies when the consent names the refused plan', async () => {
      const sharedInputs = () => ({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance({
          readAllMarkers: async () => new Map([['app', markerRecord({ storageHash: 'origin' })]]),
        }),
        contract: dummyContract,
        mode: 'apply' as const,
        migrations: createDestructiveMigrations(),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres' as const,
      });

      const refused = await executeDbUpdate(sharedInputs());
      expect(refused.ok).toBe(false);
      const planHash = !refused.ok ? refused.failure.destructiveChanges?.planHash : undefined;
      expect(planHash).toBeDefined();

      const result = await executeDbUpdate({
        ...sharedInputs(),
        consent: { planHash: planHash as string },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mode).toBe('apply');
        expect(result.value.execution).toBeDefined();
      }
    });

    it('refuses a consent naming a plan it is no longer about to apply', async () => {
      const consentedPlanHash = 'f'.repeat(64);
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance({
          readAllMarkers: async () => new Map([['app', markerRecord({ storageHash: 'origin' })]]),
        }),
        contract: dummyContract,
        mode: 'apply',
        consent: { planHash: consentedPlanHash },
        migrations: createDestructiveMigrations(),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('CONSENT_PLAN_MISMATCH');
        expect(result.failure.consentPlanMismatch).toEqual({
          consentedPlanHash,
          planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
      }
    });

    it('proceeds to runner in apply mode with acceptDataLoss: true', async () => {
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance({
          readAllMarkers: async () => new Map([['app', markerRecord({ storageHash: 'origin' })]]),
        }),
        contract: dummyContract,
        mode: 'apply',
        acceptDataLoss: true,
        migrations: createDestructiveMigrations(),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mode).toBe('apply');
        expect(result.value.execution).toBeDefined();
      }
    });

    it('returns success in plan mode regardless of destructive operations', async () => {
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance({
          readAllMarkers: async () => new Map([['app', markerRecord({ storageHash: 'origin' })]]),
        }),
        contract: dummyContract,
        mode: 'plan',
        migrations: createDestructiveMigrations(),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mode).toBe('plan');
        expect(result.value.plan.operations).toHaveLength(2);
      }
    });
  });

  it('does not disable runner execution checks in apply mode (ADR 038 idempotent replay)', async () => {
    const execute = vi.fn().mockResolvedValue(
      ok({
        perSpaceResults: [{ space: 'app', value: { operationsPlanned: 1, operationsExecuted: 1 } }],
      }),
    );
    const migrations = {
      createPlanner: () => ({
        plan: vi.fn().mockReturnValue({
          kind: 'success',
          appliedStatements: [],
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'dest' },
            operations: [
              {
                id: 'column.user.nickname',
                label: 'Add column nickname on user',
                operationClass: 'additive',
              },
            ],
          },
        }),
      }),
      createRunner: () => ({
        execute,
      }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >;

    const result = await executeDbUpdate({
      driver: createMockDriver(),
      adapter: STUB_ADAPTER,
      familyInstance: createMockFamilyInstance(),
      contract: dummyContract,
      mode: 'apply',
      acceptDataLoss: true,
      migrations,
      frameworkComponents: [],
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    const callArg = execute.mock.calls[0]?.[0] as unknown as {
      perSpaceOptions: ReadonlyArray<{ executionChecks?: unknown }>;
    };
    expect(callArg).toBeDefined();
    expect(callArg.perSpaceOptions.length).toBeGreaterThan(0);
    for (const opts of callArg.perSpaceOptions) {
      // Runner default = all checks enabled (ADR 038). The aggregate apply
      // primitive must not opt out — letting it do so would silently re-execute
      // operations whose postconditions are already satisfied on re-apply.
      expect(opts.executionChecks).toBeUndefined();
    }
  });

  describe('progress events', () => {
    it('emits introspect and plan spans in plan mode', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance(),
        contract: dummyContract,
        mode: 'plan',
        migrations: createMockMigrations(),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
        onProgress: (event) => events.push(event),
      });

      const spanIds = events.map((e) => e.spanId);
      expect(spanIds).toContain('introspect');
      expect(spanIds).toContain('plan');
      expect(spanIds).not.toContain('apply');

      for (const event of events) {
        expect(event.action).toBe('dbUpdate');
      }
    });

    it('emits introspect, plan, and apply spans in apply mode', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance(),
        contract: dummyContract,
        mode: 'apply',
        acceptDataLoss: true,
        migrations: createMockMigrations(),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
        onProgress: (event) => events.push(event),
      });

      const spanIds = events.map((e) => e.spanId);
      expect(spanIds).toContain('apply');
      expect(spanIds).toContain('introspect');
      expect(spanIds).toContain('plan');

      const applyStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
      expect(applyStart).toMatchObject({
        action: 'dbUpdate',
        label: 'Updating database across spaces',
      });

      const applyEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'apply');
      expect(applyEnd).toMatchObject({ outcome: 'ok' });
    });

    it('emits error outcome on plan span when planning fails', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance(),
        contract: dummyContract,
        mode: 'plan',
        migrations: createMockMigrations({
          planResult: { kind: 'failure', conflicts: [] },
        }),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
        onProgress: (event) => events.push(event),
      });

      const planEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'plan');
      expect(planEnd).toMatchObject({ outcome: 'error' });
    });

    it('emits error outcome on apply span when runner fails', async () => {
      const events: ControlProgressEvent[] = [];

      await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance(),
        contract: dummyContract,
        mode: 'apply',
        acceptDataLoss: true,
        migrations: createMockMigrations({
          runnerResult: notOk({
            code: 'RUNNER_ERROR',
            summary: 'Failed',
            why: 'Error',
            failingSpace: 'app',
          }),
        }),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
        onProgress: (event) => events.push(event),
      });

      const applyEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'apply');
      expect(applyEnd).toMatchObject({ outcome: 'error' });
    });

    it('does not throw when onProgress is omitted', async () => {
      const result = await executeDbUpdate({
        driver: createMockDriver(),
        adapter: STUB_ADAPTER,
        familyInstance: createMockFamilyInstance(),
        contract: dummyContract,
        mode: 'plan',
        migrations: createMockMigrations(),
        frameworkComponents: [],
        migrationsDir: FAKE_MIGRATIONS_DIR,
        targetId: 'postgres',
      });

      expect(result.ok).toBe(true);
    });
  });
});
