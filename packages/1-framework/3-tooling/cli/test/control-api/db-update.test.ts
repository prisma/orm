import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import {
  ORIGIN_SNAPSHOT_RECOVERY,
  type PlanQuestion,
} from '../../src/control-api/statements/plan-questions';
import type { ControlProgressEvent } from '../../src/control-api/types';

const FAKE_MIGRATIONS_DIR = '/tmp/__test-db-update-migrations';

const noQuestions = async (questions: readonly PlanQuestion[]) =>
  questions.map((question) => ({ verb: 'delete' as const, text: question.subject }));

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
    dataLoss: [],
    accessWidening: [],
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
      answerQuestions: noQuestions,
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
      answerQuestions: noQuestions,
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
        dataLoss: [],
        accessWidening: [],
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
      answerQuestions: noQuestions,
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
      answerQuestions: noQuestions,
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
      answerQuestions: noQuestions,
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
          dataLoss: [],
          accessWidening: [],
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
      answerQuestions: noQuestions,
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
        dataLoss: [],
        accessWidening: [],
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
      answerQuestions: noQuestions,
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
      dataLoss: [],
      accessWidening: [],
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
      answerQuestions: noQuestions,
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

  describe('questions before an apply', () => {
    const NICKNAME = { kind: 'storage', name: 'user.nickname' } as const;
    const USER = { kind: 'storage', name: 'user' } as const;

    function createDestructiveMigrations(executeSpy?: ReturnType<typeof vi.fn>) {
      return createMockMigrations({
        ...(executeSpy === undefined ? {} : { executeSpy }),
        planResult: {
          kind: 'success',
          dataLoss: [{ operationIndex: 0, subject: NICKNAME }],
          accessWidening: [{ operationIndex: 2, subject: USER, widens: true }],
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
              {
                id: 'rls.user.disable',
                label: 'Disable row-level security on user',
                operationClass: 'widening',
              },
            ],
            renderTypeScript: () => {
              throw new Error('not used in db update tests');
            },
          },
        },
        runnerResult: ok({
          perSpaceResults: [
            { space: 'app', value: { operationsPlanned: 3, operationsExecuted: 3 } },
          ],
        }),
      });
    }

    function applyInputs(overrides: Partial<Parameters<typeof executeDbUpdate>[0]> = {}) {
      return {
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
        answerQuestions: noQuestions,
        ...overrides,
      };
    }

    it('asks about each loss and each access widening in one batch before applying', async () => {
      const asked: { question: string; subject: string; verbs: readonly string[] }[] = [];
      const execute = vi.fn().mockResolvedValue(
        ok({
          perSpaceResults: [
            { space: 'app', value: { operationsPlanned: 3, operationsExecuted: 3 } },
          ],
        }),
      );
      const result = await executeDbUpdate(
        applyInputs({
          migrations: createDestructiveMigrations(execute),
          answerQuestions: async (questions) => {
            expect(execute).not.toHaveBeenCalled();
            asked.push(
              ...questions.map(({ question, subject, verbs }) => ({ question, subject, verbs })),
            );
            return questions.map((question) => ({
              verb: question.verbs.includes('allow') ? 'allow' : 'delete',
              text: question.subject,
            }));
          },
        }),
      );

      expect(asked).toEqual([
        {
          question: `Drop column nickname from user would lose the data in "user.nickname", named by its storage name because the origin contract is unknown; --delete loses its rows. ${ORIGIN_SNAPSHOT_RECOVERY}`,
          subject: 'user.nickname',
          verbs: ['delete'],
        },
        {
          question:
            'Disable row-level security on user would widen who can read and write its rows.',
          subject: 'user',
          verbs: ['allow'],
        },
      ]);
      expect(result.ok && result.value.appliedStatements).toEqual([
        {
          verb: 'delete',
          statement: { kind: 'delete', subject: NICKNAME },
          operationIndexes: [0],
          description: 'delete storage "user.nickname"',
        },
        {
          verb: 'allow',
          statement: { kind: 'allow', subject: USER },
          operationIndexes: [2],
          description: 'allow storage "user"',
        },
      ]);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('takes delete and allow statements as answers without asking', async () => {
      const answerQuestions = vi.fn(noQuestions);
      const result = await executeDbUpdate(
        applyInputs({
          statements: [
            { verb: 'delete', text: 'user.nickname' },
            { verb: 'allow', text: 'user' },
          ],
          answerQuestions,
        }),
      );

      expect(result.ok).toBe(true);
      expect(answerQuestions).toHaveBeenCalledWith([]);
    });

    it('refuses delete and allow statements that answer no question, before applying', async () => {
      const execute = vi.fn();
      const error = await executeDbUpdate(
        applyInputs({
          migrations: createDestructiveMigrations(execute),
          statements: [
            { verb: 'delete', text: 'user.nickname' },
            { verb: 'delete', text: 'Nope' },
            { verb: 'allow', text: 'user' },
            { verb: 'allow', text: 'post' },
          ],
        }),
      ).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: 'MIGRATION.STATEMENT_ANSWERS_NO_QUESTION',
        message: 'Statements "--delete Nope" and "--allow post" answer no question of the plan',
        meta: {
          statements: [
            { verb: 'delete', text: 'Nope' },
            { verb: 'allow', text: 'post' },
          ],
          subjects: ['user.nickname', 'user'],
        },
      });
      expect(execute).not.toHaveBeenCalled();
    });

    it('answers every data-loss question with acceptDataLoss: true, and still asks about access', async () => {
      const asked: string[] = [];
      const result = await executeDbUpdate(
        applyInputs({
          acceptDataLoss: true,
          answerQuestions: async (questions) => {
            asked.push(...questions.map(({ subject }) => subject));
            return questions.map(({ subject }) => ({ verb: 'allow', text: subject }));
          },
        }),
      );

      expect(result.ok).toBe(true);
      expect(asked).toEqual(['user']);
    });

    it('answers every question with acceptDataLoss and acceptAccessWidening', async () => {
      const answerQuestions = vi.fn(noQuestions);
      const result = await executeDbUpdate(
        applyInputs({ acceptDataLoss: true, acceptAccessWidening: true, answerQuestions }),
      );

      expect(result.ok).toBe(true);
      expect(answerQuestions).toHaveBeenCalledWith([]);
    });

    it('rejects an answer callback that leaves a question unanswered, before applying', async () => {
      const execute = vi.fn();
      const answers = [{ verb: 'delete', text: 'user.nickname' }] as const;
      const error = await executeDbUpdate(
        applyInputs({
          migrations: createDestructiveMigrations(execute),
          answerQuestions: async () => answers,
        }),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InternalError);
      expect(error).toMatchObject({
        message:
          'answerQuestions gave 1 answer for 2 questions; answer each question in order, or throw to refuse.',
        cause: { questions: ['user.nickname', 'user'], answers },
      });
      expect(execute).not.toHaveBeenCalled();
    });

    it('rejects an answer the question does not accept, before applying', async () => {
      const execute = vi.fn();
      const error = await executeDbUpdate(
        applyInputs({
          migrations: createDestructiveMigrations(execute),
          answerQuestions: async () => [
            { verb: 'delete', text: 'user.nickname' },
            { verb: 'delete', text: 'user' },
          ],
        }),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InternalError);
      expect(error).toMatchObject({
        message:
          'answerQuestions answered "Disable row-level security on user would widen who can read and write its rows." with delete, which it does not accept; it accepts allow.',
        cause: { question: 'user', verbs: ['allow'], answer: { verb: 'delete', text: 'user' } },
      });
      expect(execute).not.toHaveBeenCalled();
    });

    it('refuses, without asking, delete and allow statements that answer no question in plan mode', async () => {
      const answerQuestions = vi.fn(noQuestions);
      const error = await executeDbUpdate(
        applyInputs({
          mode: 'plan',
          answerQuestions,
          statements: [
            { verb: 'delete', text: 'user.nickname' },
            { verb: 'allow', text: 'post' },
          ],
        }),
      ).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: 'MIGRATION.STATEMENT_ANSWERS_NO_QUESTION',
        meta: { statements: [{ verb: 'allow', text: 'post' }] },
      });
      expect(answerQuestions).not.toHaveBeenCalled();
    });

    it('takes delete and allow statements that answer questions in plan mode', async () => {
      const result = await executeDbUpdate(
        applyInputs({
          mode: 'plan',
          statements: [
            { verb: 'delete', text: 'user.nickname' },
            { verb: 'allow', text: 'user' },
          ],
        }),
      );

      expect(result.ok).toBe(true);
    });

    it('asks nothing in plan mode, and lists the questions an apply would ask', async () => {
      const answerQuestions = vi.fn(noQuestions);
      const result = await executeDbUpdate(applyInputs({ mode: 'plan', answerQuestions }));

      expect(answerQuestions).not.toHaveBeenCalled();
      expect(
        result.ok && {
          dataLoss: result.value.dataLoss,
          accessWidening: result.value.accessWidening,
        },
      ).toEqual({
        dataLoss: [{ operationIndex: 0, subject: NICKNAME, text: 'user.nickname' }],
        accessWidening: [{ operationIndex: 2, subject: USER, widens: true, text: 'user' }],
      });
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
          dataLoss: [],
          accessWidening: [],
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
      answerQuestions: noQuestions,
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
        answerQuestions: noQuestions,
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
        answerQuestions: noQuestions,
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
        answerQuestions: noQuestions,
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
        answerQuestions: noQuestions,
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
        answerQuestions: noQuestions,
        targetId: 'postgres',
      });

      expect(result.ok).toBe(true);
    });
  });
});
