import { readdir } from 'node:fs/promises';
import type { PrismaConfig } from '@internal/config/config-types';
import type { DeclaredDatabasePolicies } from '@internal/framework-components/control';
import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeMigrationPlanCommand } from '../../src/control-api/operations/migration-plan';
import type { AnswerPlanQuestions } from '../../src/control-api/statements/plan-questions';
import type { StatementText } from '../../src/control-api/statements/statement-text';
import { BIN_GROUPS } from '../../src/orm/cli';
import { CliStructuredError } from '../../src/utils/cli-errors';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  ADDITIVE_OP,
  createOfflineProject,
  DESTRUCTIVE_OP,
  type FakePlannerScript,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  renderContractDtsMock,
  resetRenderContractDtsMock,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;
const HASH_PRODUCTION = `dead${'2'.repeat(60)}`;
const INITIAL = '20260101T0000_initial';

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

const DISABLE_RLS = { id: 'rowLevelSecurity.public.user.disable', label: 'Disable RLS on user' };

const LOSES_DATA: FakePlannerScript = {
  operations: [DESTRUCTIVE_OP],
  dataLoss: [{ operationIndex: 0, subject: { kind: 'storage', name: 'legacy' } }],
};

const CHANGES_ACCESS: FakePlannerScript = {
  operations: [ADDITIVE_OP, { ...DISABLE_RLS, operationClass: 'widening' }],
  accessChanges: [
    { operationIndex: 1, subject: { kind: 'storage', name: 'public.user' }, widens: true },
  ],
};

async function projectWithProductionRef(
  policies: DeclaredDatabasePolicies | undefined,
): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: INITIAL,
    from: null,
    to: HASH_FROM,
  });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_PRODUCTION,
  });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  await writeRef(join(project.appMigrationsDir, 'refs'), 'production', {
    hash: HASH_PRODUCTION,
    invariants: [],
    ...(policies === undefined ? {} : { policies }),
  });
  return project;
}

async function plan(project: OfflineProject, script: FakePlannerScript, args: readonly string[]) {
  const run = await createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: offlineConfig({ project, script }),
  }).run(['migration', 'plan', ...args, '--json'], { cwd: project.dir });
  const terminal = run.json.at(-1);
  return {
    exitCode: run.exitCode,
    error:
      terminal !== undefined && terminal.kind === 'result' && !terminal.envelope.ok
        ? terminal.envelope.error
        : undefined,
    migrations: (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs'),
  };
}

describe('migration plan --to <ref>, data protection', () => {
  it('refuses a plan that loses data when the ref declares data-loss-forbidden, and writes nothing', async () => {
    const project = await projectWithProductionRef({
      dataProtection: { dataLoss: 'data-loss-forbidden' },
    });

    expect(await plan(project, LOSES_DATA, ['--to', 'production'])).toMatchObject({
      exitCode: 2,
      error: {
        code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
        summary: 'production declares a data protection policy that forbids data loss',
        meta: {
          spaceId: 'app',
          command: 'migration plan',
          settings: [{ setting: 'dataLoss', level: 'data-loss-forbidden' }],
          operations: [
            {
              setting: 'dataLoss',
              spaceId: 'app',
              operationId: DESTRUCTIVE_OP.id,
              subject: 'legacy',
              label: DESTRUCTIVE_OP.label,
            },
          ],
        },
      },
      migrations: [INITIAL],
    });
  });

  it('refuses a plan that changes access when the ref declares access-widening-forbidden, and writes nothing', async () => {
    const project = await projectWithProductionRef({
      dataProtection: { accessWidening: 'access-widening-forbidden' },
    });

    expect(await plan(project, CHANGES_ACCESS, ['--to', 'production'])).toMatchObject({
      exitCode: 2,
      error: {
        code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
        meta: {
          settings: [{ setting: 'accessWidening', level: 'access-widening-forbidden' }],
          operations: [{ operationId: DISABLE_RLS.id, subject: 'public.user' }],
        },
      },
      migrations: [INITIAL],
    });
  });

  it('writes the plan when the ref declares no data protection setting', async () => {
    const project = await projectWithProductionRef({ change: ['migrate'] });

    const planned = await plan(project, CHANGES_ACCESS, ['--to', 'production']);

    expect({ exitCode: planned.exitCode, migrations: planned.migrations.length }).toEqual({
      exitCode: 0,
      migrations: 2,
    });
  });

  it('checks nothing when given no ref', async () => {
    const project = await projectWithProductionRef({
      dataProtection: { accessWidening: 'access-widening-forbidden' },
    });

    const planned = await plan(project, CHANGES_ACCESS, []);

    expect({ exitCode: planned.exitCode, migrations: planned.migrations.length }).toEqual({
      exitCode: 0,
      migrations: 2,
    });
  });
});

const LEGACY_LOSS = {
  operationIndex: 1,
  subject: { kind: 'model', namespaceId: 'app', model: 'Legacy' },
} as const;

/** A project whose database sits at HASH_FROM with models User and Legacy, and ref production at a contract with User and Archive; `withHistory: false` leaves the graph empty, so the plan writes a baseline first. */
async function renamingProject(
  policies: DeclaredDatabasePolicies,
  withHistory = true,
): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO, models: ['User', 'Archive'] });
  if (withHistory) {
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: INITIAL,
      from: null,
      to: HASH_FROM,
    });
  }
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_FROM,
    models: ['User', 'Legacy'],
  });
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_PRODUCTION,
    models: ['User', 'Archive'],
  });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  await writeRef(join(project.appMigrationsDir, 'refs'), 'production', {
    hash: HASH_PRODUCTION,
    invariants: [],
    policies,
  });
  return project;
}

async function planThroughControlApi(
  project: OfflineProject,
  script: FakePlannerScript,
  statements: readonly StatementText[],
  answerQuestions: AnswerPlanQuestions,
) {
  const result = await executeMigrationPlanCommand(
    {
      config: {
        ...offlineConfig({ project, script }),
        baseDir: project.dir,
      } as unknown as PrismaConfig,
      cwd: project.dir,
      to: 'production',
      statements,
      answerQuestions,
      client: { renderContractDts: renderContractDtsMock },
    },
    Date.now(),
  );
  return {
    result,
    migrations: (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs'),
  };
}

describe('migration plan --to <ref>, renames', () => {
  it('refuses an access change that only the plan made after an interactive rename holds, and writes nothing', async () => {
    const project = await renamingProject({
      dataProtection: { accessWidening: 'access-widening-forbidden' },
    });

    const { result, migrations } = await planThroughControlApi(
      project,
      {
        ...CHANGES_ACCESS,
        dataLoss: [LEGACY_LOSS],
        statementsResolveDataLoss: true,
        statementsChangeAccess: true,
      },
      [],
      async (questions) => questions.map(() => ({ verb: 'rename', text: 'Legacy:Archive' })),
    );

    expect({
      envelope: result.ok ? undefined : result.failure.toEnvelope(),
      migrations,
    }).toMatchObject({
      envelope: {
        code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
        meta: { operations: [{ setting: 'accessWidening', operationId: DISABLE_RLS.id }] },
      },
      migrations: [INITIAL],
    });
  });

  it('writes a plan whose loss a --rename answers under a ref that forbids data loss', async () => {
    const project = await renamingProject({ dataProtection: { dataLoss: 'data-loss-forbidden' } });

    const { result, migrations } = await planThroughControlApi(
      project,
      {
        operations: [ADDITIVE_OP, DESTRUCTIVE_OP],
        dataLoss: [LEGACY_LOSS],
        statementsResolveDataLoss: true,
      },
      [{ verb: 'rename', text: 'Legacy:Archive' }],
      async () => [],
    );

    expect({ ok: result.ok, migrations: migrations.length }).toEqual({ ok: true, migrations: 2 });
  });

  it('refuses a lossy delta after an automatic baseline, and writes neither migration', async () => {
    const project = await renamingProject(
      { dataProtection: { dataLoss: 'data-loss-forbidden' } },
      false,
    );

    const { result, migrations } = await planThroughControlApi(
      project,
      { operations: [ADDITIVE_OP, DESTRUCTIVE_OP], dataLossByPlan: [[], [LEGACY_LOSS]] },
      [],
      async () => [],
    );

    expect({
      code: result.ok ? undefined : result.failure.code,
      migrations,
    }).toEqual({ code: 'MIGRATION.DATA_PROTECTION_FORBIDS', migrations: [] });
  });
});

describe('migration plan --to <ref>, a placeholder before the refused operation', () => {
  it('names the refused operation, not the one after it', async () => {
    const project = await projectWithProductionRef({
      dataProtection: { dataLoss: 'data-loss-forbidden' },
    });
    const placeholder = new CliStructuredError(
      'MIGRATION.UNFILLED_PLACEHOLDER',
      'Unfilled migration placeholder',
      { meta: { operation: { id: 'fill.x', label: 'Fill x', operationClass: 'data' } } },
    );

    const planned = await plan(
      project,
      {
        operations: [DESTRUCTIVE_OP, ADDITIVE_OP],
        throwOnOperations: placeholder,
        placeholderAt: 0,
        dataLoss: [{ operationIndex: 1, subject: { kind: 'storage', name: 'legacy' } }],
      },
      ['--to', 'production'],
    );

    expect(planned.error).toMatchObject({
      code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
      meta: { operations: [{ operationId: DESTRUCTIVE_OP.id }] },
    });
  });
});
