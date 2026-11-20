import type { Contract } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import type { PlanQuestion } from '../../src/control-api/statements/plan-questions';

const USER = { kind: 'storage', name: 'user' } as const;

const planResult: MigrationPlannerResult = {
  kind: 'success',
  dataLoss: [],
  accessChanges: [
    { operationIndex: 0, subject: USER, widens: true },
    { operationIndex: 1, subject: USER, widens: false },
  ],
  temporaryValues: [],
  appliedStatements: [],
  plan: {
    targetId: 'postgres',
    destination: { storageHash: 'dest' },
    operations: [
      {
        id: 'rls.user.disable',
        label: 'Disable row-level security on user',
        operationClass: 'widening',
      },
      {
        id: 'policy.user.readers',
        label: 'Drop policy readers on user',
        operationClass: 'widening',
      },
    ],
    renderTypeScript: () => {
      throw new Error('not used in db update tests');
    },
  },
};

function update(mode: 'plan' | 'apply', allows: number) {
  const askedAbout: string[] = [];
  const result = executeDbUpdate({
    invocation: { cwd: '/work/app', configPath: undefined, dbGiven: false },
    driver: {
      close: vi.fn(),
      databaseName: async () => 'appdb',
    } as unknown as ControlDriverInstance<'sql', 'postgres'>,
    adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
    familyInstance: {
      familyId: 'sql',
      readAllMarkers: async () => new Map(),
      introspect: async () => ({ tables: {} }),
      deserializeContract: (ir: unknown) => ir as Contract,
      toOperationPreview: () => ({ statements: [] }),
    } as unknown as ControlFamilyInstance<'sql', unknown>,
    contract: {
      schemaVersion: '1',
      target: 'postgres',
      storage: { storageHash: 'dummy', tables: {}, namespaces: {} },
    } as unknown as Contract,
    mode,
    migrations: {
      createPlanner: () => ({ plan: () => planResult }),
      createRunner: () => ({
        execute: vi.fn().mockResolvedValue(
          ok({
            perSpaceResults: [
              { space: 'app', value: { operationsPlanned: 2, operationsExecuted: 2 } },
            ],
          }),
        ),
      }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >,
    frameworkComponents: [],
    migrationsDir: '/tmp/__test-db-update-allow-migrations',
    targetId: 'postgres',
    statements: Array.from({ length: allows }, () => ({ verb: 'allow', text: 'user' })),
    answerQuestions: async (questions: readonly PlanQuestion[]) => {
      askedAbout.push(...questions.map(({ subject }) => subject));
      return questions.map(({ subject }) => ({ verb: 'allow' as const, text: subject }));
    },
  });
  return { result, askedAbout };
}

const SECOND_ALLOW = {
  code: 'CLI.CONSENT_UNUSED',
  message:
    '--allow user was given, but the question about user was already answered by --allow user.',
  why: 'The run asked about user.',
  nextActions: [{ kind: 'user-choice', label: 'Give one flag per question.' }],
  meta: { unused: [{ verb: 'allow', values: ['user'] }], asked: ['user'] },
};

function errorShape(error: unknown) {
  const { code, message, why, nextActions, meta } = error as {
    readonly code: string;
    readonly message: string;
    readonly why?: string;
    readonly nextActions?: unknown;
    readonly meta?: unknown;
  };
  return { code, message, why, nextActions, meta };
}

describe('one --allow for every access change of a model', () => {
  it('reports one applied flag that allowed both changes, each at its position', async () => {
    const { result, askedAbout } = update('apply', 1);

    const outcome = await result;
    expect({
      askedAbout,
      appliedStatements: outcome.ok && outcome.value.appliedStatements,
    }).toEqual({
      askedAbout: [],
      appliedStatements: [
        {
          verb: 'allow',
          statement: { kind: 'allow', subject: USER },
          operationIndexes: [0, 1],
          description: 'allow storage "user"',
        },
      ],
    });
  });

  it('refuses a second --allow of the model on an apply, saying the first already allowed it', async () => {
    const error = await update('apply', 2).result.catch((caught: unknown) => caught);

    expect(errorShape(error)).toEqual(SECOND_ALLOW);
  });

  it('refuses a second --allow of the model on a dry run with the same error', async () => {
    const error = await update('plan', 2).result.catch((caught: unknown) => caught);

    expect(errorShape(error)).toEqual(SECOND_ALLOW);
  });
});
