import { rmSync } from 'node:fs';
import { asNamespaceId, type Contract, type ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  DeclaredDatabasePolicies,
  MigrationAccessChange,
  MigrationPlannerResult,
  ResolvedMigrationStatement,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import type { NamedRef } from '@internal/migration-tools/refs';
import { ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import type { PlanQuestion } from '../../src/control-api/statements/plan-questions';
import type { StatementText } from '../../src/control-api/statements/statement-text';
import { createTestProjectDir } from '../utils/test-project-dir';

const TEST_INVOCATION = { cwd: '/work/app', configPath: undefined, dbGiven: false };

const ORIGIN_HASH = 'a'.repeat(64);
const DESTINATION_HASH = 'b'.repeat(64);
const app = asNamespaceId('app');

function contractWithModels(storageHash: string, models: readonly string[]): Contract {
  return {
    formatVersion: 1,
    target: 'postgres',
    targetFamily: 'sql',
    storage: { storageHash, tables: {}, namespaces: {} },
    domain: {
      namespaces: {
        app: {
          models: Object.fromEntries(
            models.map((model) => [model, { fields: {}, relations: {}, storage: {} }]),
          ),
        },
      },
    },
  } as unknown as Contract;
}

const origin = contractWithModels(ORIGIN_HASH, ['Profile']);
const destination = contractWithModels(DESTINATION_HASH, ['User']);

const PROFILE = { kind: 'model', namespaceId: app, model: 'Profile' } as const;
const DROP_PROFILE = { id: 'dropTable.Profile', label: 'Drop table Profile' } as const;
const DISABLE_RLS = {
  id: 'rowLevelSecurity.public.User.disable',
  label: 'Disable RLS on User',
  operationClass: 'widening',
} as const;
const RENAME = { id: 'renameTable.Profile', label: 'Rename table Profile to User' };

function markerWith(policies: DeclaredDatabasePolicies | undefined): ContractMarkerRecord {
  return {
    storageHash: ORIGIN_HASH,
    profileHash: '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: policies === undefined ? {} : { policies },
    invariants: [],
  };
}

/** Without statements the plan drops `Profile`, and disables row-level security when asked to; a rename answers the drop. */
function plannerMigrations(args: {
  readonly changesAccess: boolean;
  readonly renameChangesAccess: boolean;
  readonly execute: ReturnType<typeof vi.fn>;
}) {
  const accessChanges: MigrationAccessChange[] = args.changesAccess
    ? [{ operationIndex: 1, subject: PROFILE, widens: true }]
    : [];
  return {
    createPlanner: () => ({
      plan: (options: {
        readonly origin: { readonly storageHash: string } | null;
        readonly statements: readonly ResolvedMigrationStatement[];
      }): MigrationPlannerResult =>
        options.statements.length > 0
          ? {
              kind: 'success',
              appliedStatements: options.statements.map((statement) => ({
                statement,
                operationIndexes: [0],
              })),
              dataLoss: [],
              accessChanges: args.renameChangesAccess
                ? [{ operationIndex: 1, subject: PROFILE, widens: true }]
                : [],
              temporaryValues: [],
              plan: {
                targetId: 'postgres',
                origin: options.origin,
                destination: { storageHash: DESTINATION_HASH },
                operations: [
                  { ...RENAME, operationClass: 'widening' },
                  ...(args.renameChangesAccess ? [DISABLE_RLS] : []),
                ],
                renderTypeScript: () => '',
              },
            }
          : {
              kind: 'success',
              appliedStatements: [],
              dataLoss: [
                { operationIndex: 0, subject: PROFILE, loss: 'drop', label: DROP_PROFILE.label },
              ],
              accessChanges,
              temporaryValues: [],
              plan: {
                targetId: 'postgres',
                origin: options.origin,
                destination: { storageHash: DESTINATION_HASH },
                operations: [
                  { ...DROP_PROFILE, operationClass: 'destructive' },
                  ...(args.changesAccess ? [DISABLE_RLS] : []),
                ],
                renderTypeScript: () => '',
              },
            },
    }),
    createRunner: () => ({ execute: args.execute }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function update(args: {
  readonly policies?: DeclaredDatabasePolicies;
  readonly mode?: 'plan' | 'apply';
  readonly changesAccess?: boolean;
  /** The plan made with a rename disables row-level security. */
  readonly renameChangesAccess?: boolean;
  /** Answers a data-loss question with this rename instead of a delete. */
  readonly answerLossWithRename?: string;
  readonly statements?: readonly StatementText[];
  readonly acceptDataLoss?: boolean;
  readonly acceptAccessChanges?: boolean;
  readonly ref?: NamedRef;
  readonly permitPolicyChange?: boolean;
}) {
  const dir = createTestProjectDir('db-update-data-protection');
  tempDirs.push(dir);
  const migrationsDir = join(dir, 'migrations');
  await writeContractSnapshot(migrationsDir, ORIGIN_HASH, {
    contractJson: origin,
    contractDts: '',
  });
  const execute = vi.fn().mockResolvedValue(
    ok({
      perSpaceResults: [{ space: 'app', value: { operationsPlanned: 1, operationsExecuted: 1 } }],
    }),
  );
  const asked: (readonly PlanQuestion[])[] = [];
  const result = await executeDbUpdate({
    invocation: TEST_INVOCATION,
    driver: { close: vi.fn() } as unknown as ControlDriverInstance<'sql', 'postgres'>,
    adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
    familyInstance: {
      familyId: 'sql',
      markerLocation: 'prisma_contract.marker',
      readAllMarkers: async () => new Map([['app', markerWith(args.policies)]]),
      introspect: async () => ({ tables: {} }),
      deserializeContract: (json: unknown) => json as Contract,
      toOperationPreview: () => ({ statements: [] }),
    } as unknown as ControlFamilyInstance<'sql', unknown>,
    contract: destination,
    mode: args.mode ?? 'apply',
    migrations: plannerMigrations({
      changesAccess: args.changesAccess ?? false,
      renameChangesAccess: args.renameChangesAccess ?? false,
      execute,
    }),
    frameworkComponents: [],
    migrationsDir,
    answerQuestions: async (questions) => {
      asked.push(questions);
      return questions.map((question) =>
        question.verbs.includes('allow')
          ? { verb: 'allow', text: question.subject }
          : args.answerLossWithRename === undefined
            ? { verb: 'delete', text: question.subject }
            : { verb: 'rename', text: args.answerLossWithRename },
      );
    },
    targetId: 'postgres',
    statements: args.statements ?? [],
    ...(args.acceptDataLoss === undefined ? {} : { acceptDataLoss: args.acceptDataLoss }),
    ...(args.acceptAccessChanges === undefined
      ? {}
      : { acceptAccessChanges: args.acceptAccessChanges }),
    ...(args.ref === undefined ? {} : { ref: args.ref }),
    ...(args.permitPolicyChange === undefined
      ? {}
      : { permitPolicyChange: args.permitPolicyChange }),
  });
  return { result, executed: execute.mock.calls.length, asked };
}

const DATA_LOSS_FORBIDDEN = { dataProtection: { dataLoss: 'data-loss-forbidden' } } as const;
const ACCESS_FORBIDDEN = {
  dataProtection: { accessWidening: 'access-widening-forbidden' },
} as const;
const KEEP_DATA =
  "This database's data protection policy forbids losing data, so these operations cannot run on it. If a model or field was only renamed, state the rename with --rename <old>:<new>. Otherwise keep it in the contract. To do it anyway, whoever owns the database must first change its data protection policy.";

describe('executeDbUpdate, data-loss-forbidden', () => {
  it('refuses a plan that loses data, without asking, and runs nothing', async () => {
    const { result, executed, asked } = await update({ policies: DATA_LOSS_FORBIDDEN });

    expect({
      envelope: result.ok ? undefined : result.failure.toEnvelope(),
      executed,
      asked,
    }).toEqual({
      envelope: {
        ok: false,
        code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
        severity: 'error',
        summary: "This database's data protection policy forbids data loss",
        why: 'The marker records dataLoss: data-loss-forbidden. Drop table Profile (Profile), in contract space "app".',
        fix: KEEP_DATA,
        nextActions: [{ kind: 'user-choice', label: KEEP_DATA }],
        meta: {
          spaceId: 'app',
          command: 'db update',
          settings: [{ setting: 'dataLoss', level: 'data-loss-forbidden' }],
          operations: [
            {
              setting: 'dataLoss',
              spaceId: 'app',
              operationId: DROP_PROFILE.id,
              subject: 'Profile',
              label: DROP_PROFILE.label,
              loss: 'drop',
            },
          ],
        },
      },
      executed: 0,
      asked: [],
    });
  });

  it.each([
    { name: 'acceptDataLoss', acceptDataLoss: true, statements: [] },
    { name: '--delete', statements: [{ verb: 'delete', text: 'Profile' }] as const },
  ])('refuses the loss even with $name', async ({ acceptDataLoss, statements }) => {
    const { result, executed } = await update({
      policies: DATA_LOSS_FORBIDDEN,
      statements,
      ...(acceptDataLoss === undefined ? {} : { acceptDataLoss }),
    });

    expect({ code: result.ok ? undefined : result.failure.code, executed }).toEqual({
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      executed: 0,
    });
  });

  it('refuses a dry run exactly as a real run', async () => {
    const { result } = await update({ policies: DATA_LOSS_FORBIDDEN, mode: 'plan' });

    expect(result.ok ? undefined : result.failure.code).toBe('MIGRATION.DATA_PROTECTION_FORBIDS');
  });

  it('runs a plan whose loss a --rename answers', async () => {
    const { result, executed } = await update({
      policies: DATA_LOSS_FORBIDDEN,
      statements: [{ verb: 'rename', text: 'Profile:User' }],
    });

    expect({ ok: result.ok, executed }).toEqual({ ok: true, executed: 1 });
  });

  it("refuses under the ref's forbidden setting when the run consents to it", async () => {
    const { result, executed } = await update({
      ref: {
        name: 'production',
        hash: DESTINATION_HASH,
        invariants: [],
        policies: DATA_LOSS_FORBIDDEN,
      },
      permitPolicyChange: true,
    });

    expect({
      summary: result.ok ? undefined : result.failure.toEnvelope().summary,
      executed,
    }).toEqual({
      summary: 'production declares a data protection policy that forbids data loss',
      executed: 0,
    });
  });
});

describe('executeDbUpdate, access-widening-forbidden', () => {
  it('refuses a plan that changes access even with acceptAccessChanges', async () => {
    const { result, executed, asked } = await update({
      policies: ACCESS_FORBIDDEN,
      changesAccess: true,
      acceptDataLoss: true,
      acceptAccessChanges: true,
    });

    expect({
      meta: result.ok ? undefined : result.failure.toEnvelope().meta,
      executed,
      asked,
    }).toEqual({
      meta: {
        spaceId: 'app',
        command: 'db update',
        settings: [{ setting: 'accessWidening', level: 'access-widening-forbidden' }],
        operations: [
          {
            setting: 'accessWidening',
            spaceId: 'app',
            operationId: DISABLE_RLS.id,
            subject: 'Profile',
            label: DISABLE_RLS.label,
          },
        ],
      },
      executed: 0,
      asked: [],
    });
  });
});

describe('executeDbUpdate, permitted', () => {
  it('applies every loss and access change without asking anyone', async () => {
    const { result, executed, asked } = await update({
      policies: {
        dataProtection: {
          dataLoss: 'data-loss-permitted',
          accessWidening: 'access-widening-permitted',
        },
      },
      changesAccess: true,
    });

    expect({ ok: result.ok, executed, asked }).toEqual({ ok: true, executed: 1, asked: [[]] });
  });

  it('accepts a --delete given anyway', async () => {
    const { result, executed } = await update({
      policies: { dataProtection: { dataLoss: 'data-loss-permitted' } },
      statements: [{ verb: 'delete', text: 'Profile' }],
    });

    expect({ ok: result.ok, executed }).toEqual({ ok: true, executed: 1 });
  });
});

describe('executeDbUpdate, with-consent', () => {
  it('asks about the loss and the access change', async () => {
    const { result, asked } = await update({ changesAccess: true });

    expect({
      ok: result.ok,
      asked: asked.map((questions) => questions.map(({ verbs }) => verbs.includes('allow'))),
    }).toEqual({ ok: true, asked: [[false, true]] });
  });
});

describe('executeDbUpdate, a plan made again after a question is answered', () => {
  it('refuses an access change that only the plan made after an interactive rename holds', async () => {
    const { result, executed } = await update({
      policies: ACCESS_FORBIDDEN,
      renameChangesAccess: true,
      answerLossWithRename: 'Profile:User',
    });

    expect({
      meta: result.ok ? undefined : result.failure.toEnvelope().meta,
      executed,
    }).toEqual({
      meta: {
        spaceId: 'app',
        command: 'db update',
        settings: [{ setting: 'accessWidening', level: 'access-widening-forbidden' }],
        operations: [
          {
            setting: 'accessWidening',
            spaceId: 'app',
            operationId: DISABLE_RLS.id,
            subject: 'User',
            label: DISABLE_RLS.label,
          },
        ],
      },
      executed: 0,
    });
  });
});

describe('executeDbUpdate, --rename under data-loss-permitted', () => {
  it('applies the rename rather than deleting the subject', async () => {
    const { result, executed } = await update({
      policies: { dataProtection: { dataLoss: 'data-loss-permitted' } },
      statements: [{ verb: 'rename', text: 'Profile:User' }],
    });

    expect({
      statements: result.ok ? result.value.appliedStatements?.map(({ verb }) => verb) : result,
      executed,
    }).toEqual({ statements: ['rename'], executed: 1 });
  });
});

describe('executeDbUpdate --dry-run under permitted', () => {
  it('names the permitted settings, about whose operations an apply asks nothing', async () => {
    const { result } = await update({
      policies: { dataProtection: { dataLoss: 'data-loss-permitted' } },
      mode: 'plan',
      changesAccess: true,
    });

    expect(result.ok ? result.value.permitted : result.failure).toEqual(['dataLoss']);
  });
});

describe('executeDbUpdate, one setting permitted beside the other', () => {
  const askedVerbs = (asked: readonly (readonly PlanQuestion[])[]) =>
    asked.map((questions) =>
      questions.map(({ verbs }) => (verbs.includes('allow') ? 'allow' : 'delete')),
    );

  it('still asks about the access change when only data loss is permitted', async () => {
    const { result, executed, asked } = await update({
      policies: { dataProtection: { dataLoss: 'data-loss-permitted' } },
      changesAccess: true,
    });

    expect({ ok: result.ok, executed, asked: askedVerbs(asked) }).toEqual({
      ok: true,
      executed: 1,
      asked: [['allow']],
    });
  });

  it('still asks about the loss when only access changes are permitted', async () => {
    const { result, executed, asked } = await update({
      policies: { dataProtection: { accessWidening: 'access-widening-permitted' } },
      changesAccess: true,
    });

    expect({ ok: result.ok, executed, asked: askedVerbs(asked) }).toEqual({
      ok: true,
      executed: 1,
      asked: [['delete']],
    });
  });
});

describe('executeDbUpdate --permit-policy-change, the permitted level', () => {
  const production = (dataLoss: 'data-loss-permitted' | 'data-loss-with-consent'): NamedRef => ({
    name: 'production',
    hash: DESTINATION_HASH,
    invariants: [],
    policies: { dataProtection: { dataLoss } },
  });

  it("asks nothing when the ref's level is permitted, whatever the marker records", async () => {
    const { result, executed, asked } = await update({
      policies: DATA_LOSS_FORBIDDEN,
      ref: production('data-loss-permitted'),
      permitPolicyChange: true,
    });

    expect({ ok: result.ok, executed, asked }).toEqual({ ok: true, executed: 1, asked: [[]] });
  });

  it("asks when the ref's level is with-consent, though the marker records permitted", async () => {
    const { asked } = await update({
      policies: { dataProtection: { dataLoss: 'data-loss-permitted' } },
      ref: production('data-loss-with-consent'),
      permitPolicyChange: true,
    });

    expect(asked.map((questions) => questions.length)).toEqual([1]);
  });
});

describe('executeDbUpdate apply under permitted', () => {
  it('names the permitted settings, which answered without asking', async () => {
    const { result } = await update({
      policies: { dataProtection: { dataLoss: 'data-loss-permitted' } },
    });

    expect(
      result.ok
        ? {
            permitted: result.value.permitted,
            statements: result.value.appliedStatements.map(({ verb }) => verb),
          }
        : result.failure,
    ).toEqual({ permitted: ['dataLoss'], statements: ['delete'] });
  });
});
