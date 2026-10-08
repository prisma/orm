import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { errorUnfilledPlaceholder } from '../../src/utils/cli-errors';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  ADDITIVE_OP,
  createOfflineProject,
  type FakePlannerScript,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  resetRenderContractDtsMock,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function harness(project: OfflineProject, script: FakePlannerScript = {}) {
  return createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: offlineConfig({ project, script }),
  });
}

async function plannedDirs(project: OfflineProject): Promise<readonly string[]> {
  try {
    return (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs').sort();
  } catch {
    return [];
  }
}

/** The database is at a contract with `Profile`; the emitted contract has `User` instead. */
async function renamingProject(options: { readonly history: boolean } = { history: true }) {
  const project = await createOfflineProject({ storageHash: HASH_TO, models: ['User', 'Post'] });
  if (options.history) {
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
  }
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_FROM,
    models: ['Profile', 'Article'],
  });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

const profileToUser = {
  kind: 'rename',
  entity: 'model',
  from: { namespaceId: 'app', model: 'Profile' },
  to: { namespaceId: 'app', model: 'User' },
};

describe('migration plan --rename', () => {
  it('hands the planner the resolved statements in the order given', async () => {
    const project = await renamingProject();
    const statementsReceived: unknown[][] = [];
    const run = await harness(project, { statementsReceived }).run(
      ['migration', 'plan', '--rename', 'Profile:User', '--rename', 'Article:Post'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(statementsReceived).toEqual([
      [
        profileToUser,
        {
          kind: 'rename',
          entity: 'model',
          from: { namespaceId: 'app', model: 'Article' },
          to: { namespaceId: 'app', model: 'Post' },
        },
      ],
    ]);
  });

  it('reports the applied statements in JSON and under the operations in human output', async () => {
    const project = await renamingProject();
    const run = await harness(project).run(['migration', 'plan', '--rename', 'Profile:User'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.data).toMatchObject({
      appliedStatements: [
        {
          statement: profileToUser,
          description: 'rename model "Profile" to "User"',
          operationIndexes: [0],
        },
      ],
    });
    const human = run.presented?.presentation.human ?? [];
    const statementsIndex = human.findIndex(
      (block) => block.kind === 'tree' && block.roots[0]?.label === 'Statements applied',
    );
    const operationsIndex = human.findIndex(
      (block) => block.kind === 'tree' && block.roots[0]?.label !== 'Statements applied',
    );
    expect(human[statementsIndex]).toEqual({
      kind: 'tree',
      roots: [
        {
          label: 'Statements applied',
          children: [{ label: 'rename model "Profile" to "User" (1 operation)' }],
        },
      ],
    });
    expect(statementsIndex).toBeGreaterThan(operationsIndex);
  });

  it('refuses an unresolvable statement before writing anything', async () => {
    const project = await renamingProject();
    const statementsReceived: unknown[][] = [];
    const run = await harness(project, { statementsReceived }).run(
      ['migration', 'plan', '--rename', 'Account:User', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.STATEMENT_UNRESOLVED' } },
    });
    expect(statementsReceived).toEqual([]);
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('refuses a malformed statement', async () => {
    const project = await renamingProject();
    const run = await harness(project).run(['migration', 'plan', '--rename', 'Profile', '--json'], {
      cwd: project.dir,
    });
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.STATEMENT_INVALID' } },
    });
  });

  it('refuses every statement on a plan from an empty database', async () => {
    const project = await renamingProject();
    const run = await harness(project).run(
      ['migration', 'plan', '--from', '@empty', '--rename', 'Profile:User', '--json'],
      { cwd: project.dir },
    );
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.STATEMENT_UNRESOLVED',
          why: expect.stringContaining('origin contract has no model "Profile" (models: (none))'),
        },
      },
    });
  });

  /**
   * The database is at the emitted contract's storage hash, but the snapshot of that hash still
   * names the model `Profile`: a rename whose table name is kept leaves the storage unchanged.
   */
  async function storageUnchangedProject() {
    const project = await createOfflineProject({ storageHash: HASH_TO, models: ['User', 'Post'] });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_TO,
    });
    await seedContractSnapshot({
      migrationsDir: project.migrationsDir,
      storageHash: HASH_TO,
      models: ['Profile', 'Article'],
    });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_TO });
    return project;
  }

  it('reports a statement that needs no operations as applied, without writing a package', async () => {
    const project = await storageUnchangedProject();
    const run = await harness(project, { operations: [] }).run(
      ['migration', 'plan', '--rename', 'Profile:User'],
      { cwd: project.dir, isTty: { stdout: true } },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      noOp: true,
      appliedStatements: [{ statement: profileToUser, operationIndexes: [] }],
    });
    expect(run.presented?.presentation.human.at(1)).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'No changes to plan: the statements need no operations',
    });
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('fails planning when the storage changed but the planner planned nothing, statements or not', async () => {
    const project = await renamingProject();
    const run = await harness(project, { operations: [] }).run(
      ['migration', 'plan', '--rename', 'Profile:User', '--json'],
      { cwd: project.dir },
    );

    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.PLANNING_FAILED' } },
    });
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('passes the statements to the delta of an auto-baseline plan only', async () => {
    const project = await renamingProject({ history: false });
    const statementsReceived: unknown[][] = [];
    const run = await harness(project, { statementsReceived }).run(
      ['migration', 'plan', '--name', 'delta', '--rename', 'Profile:User'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(statementsReceived).toEqual([[], [profileToUser]]);
    expect(run.presented?.data).toMatchObject({
      appliedStatements: [{ statement: profileToUser }],
    });
  });

  it('writes no package, not even the auto-baseline, when the delta refuses a statement', async () => {
    const project = await renamingProject({ history: false });
    const run = await harness(project, { refuseStatements: true }).run(
      ['migration', 'plan', '--name', 'delta', '--rename', 'Profile:User', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.PLANNING_FAILED' } },
    });
    expect(await plannedDirs(project)).toEqual([]);
  });

  it('lists the resolved operations and the statements of a plan that has placeholders, in JSON and human output', async () => {
    const project = await renamingProject();
    const run = await harness(project, {
      operations: [ADDITIVE_OP],
      throwOnOperations: errorUnfilledPlaceholder('backfill'),
    }).run(['migration', 'plan', '--rename', 'Profile:User'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      pendingPlaceholders: true,
      operations: [{ id: ADDITIVE_OP.id }],
      appliedStatements: [{ statement: profileToUser, operationIndexes: [0] }],
    });
    const labels = (run.presented?.presentation.human ?? []).flatMap((block) =>
      block.kind === 'tree'
        ? block.roots.flatMap((root) => [
            root.label,
            ...(root.children ?? []).map((child) => child.label),
          ])
        : [],
    );
    expect(labels).toEqual(expect.arrayContaining([ADDITIVE_OP.label, 'Statements applied']));
  });

  it('reports the statements of an auto-baseline plan whose storage did not change, with no operations', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO, models: ['User', 'Post'] });
    await seedContractSnapshot({
      migrationsDir: project.migrationsDir,
      storageHash: HASH_TO,
      models: ['Profile', 'Post'],
    });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_TO });
    const run = await harness(project).run(['migration', 'plan', '--rename', 'Profile:User'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      appliedStatements: [
        {
          statement: profileToUser,
          description: 'rename model "Profile" to "User"',
          operationIndexes: [],
        },
      ],
    });
    expect(run.presented?.presentation.human).toContainEqual({
      kind: 'tree',
      roots: [
        {
          label: 'Statements applied',
          children: [{ label: 'rename model "Profile" to "User" (no operations)' }],
        },
      ],
    });
  });

  it('writes nothing when the auto-baseline delta is refused, and only the baseline when it has no operations', async () => {
    const refusedProject = await renamingProject({ history: false });
    const refused = await harness(refusedProject, { refuseStatements: true }).run(
      ['migration', 'plan', '--name', 'delta', '--rename', 'Profile:User', '--json'],
      { cwd: refusedProject.dir },
    );
    const emptyProject = await renamingProject({ history: false });
    const empty = await harness(emptyProject, { operationsByPlan: [[ADDITIVE_OP], []] }).run(
      ['migration', 'plan', '--name', 'delta', '--json'],
      { cwd: emptyProject.dir },
    );

    const conflictKind = (run: typeof refused) => {
      const terminal = run.json.at(-1);
      const error =
        terminal !== undefined && terminal.kind === 'result' && !terminal.envelope.ok
          ? terminal.envelope.error
          : undefined;
      const conflicts = error?.meta?.['conflicts'];
      return Array.isArray(conflicts) ? conflicts[0]?.kind : undefined;
    };
    expect({
      refused: { kind: conflictKind(refused), dirs: await plannedDirs(refusedProject) },
      empty: {
        kind: conflictKind(empty),
        dirs: (await plannedDirs(emptyProject)).map((dir) => dir.replace(/^\d{8}T\d{4}_/, '')),
      },
    }).toEqual({
      refused: { kind: 'statementRefused', dirs: [] },
      empty: { kind: 'noDatabaseChange', dirs: ['baseline'] },
    });
  });
});
