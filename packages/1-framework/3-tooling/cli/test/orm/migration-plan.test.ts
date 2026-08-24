import { readdir } from 'node:fs/promises';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import {
  ADDITIVE_OP,
  contractJson,
  createOfflineProject,
  DESTRUCTIVE_OP,
  type FakePlannerScript,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;

afterEach(removeOfflineProjects);

function harness(
  project: OfflineProject,
  options: {
    readonly script?: FakePlannerScript;
    readonly overrides?: Record<string, unknown>;
  } = {},
) {
  return createTestCli({
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    config: {
      orm: {
        ...offlineConfig({ project, ...(options.script ? { script: options.script } : {}) }),
        ...options.overrides,
      },
    },
  });
}

async function plannedDirs(project: OfflineProject): Promise<readonly string[]> {
  return (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs').sort();
}

/** A project whose database sits at HASH_FROM and whose contract is HASH_TO. */
async function plannableProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_FROM,
  });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

/** A project whose database already sits at the emitted contract. */
async function upToDateProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_TO,
  });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_TO });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_TO });
  return project;
}

describe('migration plan', () => {
  it('settles as a completed envelope carrying the plan document', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan', '--name', 'add-users'], {
      cwd: project.dir,
    });
    const dirs = await plannedDirs(project);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      noOp: false,
      from: HASH_FROM,
      to: HASH_TO,
      dir: join('migrations', 'app', dirs.at(-1) ?? ''),
      operations: [{ id: 'table.user', label: 'Create table "user"', operationClass: 'additive' }],
      emittedExtensionDirs: [],
    });
    expect(dirs.at(-1)).toMatch(/_add_users$/);
  });

  it('presents the header, the planned operations and the contract edge', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan', '--name', 'add-users'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });
    const dir = join('migrations', 'app', (await plannedDirs(project)).at(-1) ?? '');

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: join('output', 'contract.json') },
          { label: 'migrations', value: join('migrations', 'app') },
          { label: 'name', value: 'add-users' },
        ],
      },
      { kind: 'summary', status: 'ok', text: expect.any(String) },
      { kind: 'tree', roots: [{ label: dir, children: [{ label: 'Create table "user"' }] }] },
      {
        kind: 'fields',
        rows: [
          { label: 'from', value: [{ text: HASH_FROM, tone: 'identifier' }] },
          { label: 'to', value: [{ text: HASH_TO, tone: 'identifier' }] },
          { label: 'app space', value: dir },
        ],
      },
    ]);
  });

  it('marks a destructive operation and warns under the tree', async () => {
    const project = await plannableProject();

    const run = await harness(project, {
      script: { operations: [ADDITIVE_OP, DESTRUCTIVE_OP] },
    }).run(['migration', 'plan'], { cwd: project.dir, isTty: { stdout: true } });
    const blocks = run.presented?.presentation.human ?? [];

    expect(blocks[2]).toEqual({
      kind: 'tree',
      roots: [
        {
          label: join('migrations', 'app', (await plannedDirs(project)).at(-1) ?? ''),
          children: [
            { label: 'Create table "user"' },
            { label: 'Drop table "legacy"', status: 'warn' },
          ],
        },
      ],
    });
    expect(blocks[3]).toEqual({
      kind: 'summary',
      status: 'warn',
      text: 'This migration contains destructive operations that may cause data loss.',
    });
  });

  it('names reviewing and applying the migration as the typed next actions', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });
    const dir = join('migrations', 'app', (await plannedDirs(project)).at(-1) ?? '');

    expect(run.presented?.presentation.next).toEqual([
      { kind: 'edit-file', label: `Review ${dir}` },
      { kind: 'run-command', label: 'Apply the migration', command: '{bin} db migrate' },
    ]);
  });

  it('reports no changes without writing a package', async () => {
    const project = await upToDateProject();

    const run = await harness(project).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ noOp: true, from: HASH_TO, to: HASH_TO });
    expect(run.presented?.presentation.human.at(1)).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'No changes detected',
    });
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('writes the baseline and delta packages for an auto-baseline plan', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project).run(['migration', 'plan', '--name', 'delta'], {
      cwd: project.dir,
    });
    const dirs = await plannedDirs(project);

    expect(run.exitCode).toBe(0);
    expect(dirs.map((entry) => entry.replace(/^\d+T\d+_/, ''))).toEqual(['baseline', 'delta']);
    expect(run.presented?.data).toMatchObject({
      baselineDir: join('migrations', 'app', dirs[0] ?? ''),
      dir: join('migrations', 'app', dirs[1] ?? ''),
    });
  });

  it('renders extension-space dirs under the configured migrations directory', async () => {
    const EXT_HASH = `f00d${'3'.repeat(60)}`;
    const extMetadataBase = {
      from: null,
      to: EXT_HASH,
      providedInvariants: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const extMetadata = {
      ...extMetadataBase,
      migrationHash: computeMigrationHash(extMetadataBase, []),
    };
    const project = await createOfflineProject({ storageHash: HASH_TO });
    const migrationsDir = join(project.dir, 'db-migrations');
    const appMigrationsDir = join(migrationsDir, 'app');
    await seedMigrationPackage({
      appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedContractSnapshot({ migrationsDir, storageHash: HASH_FROM });
    await seedDbRef({ appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project, {
      overrides: {
        migrations: { dir: 'db-migrations' },
        extensions: [
          {
            kind: 'extension',
            id: 'cipherstash',
            familyId: 'sql',
            targetId: 'postgres',
            version: '1.0.0',
            create: () => ({}),
            contractSpace: {
              contractJson: contractJson(EXT_HASH),
              headRef: { hash: EXT_HASH, invariants: [] },
              migrations: [{ dirName: '0001_seed', metadata: extMetadata, ops: [] }],
            },
          },
        ],
      },
    }).run(['migration', 'plan', '--name', 'add-users'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      emittedExtensionDirs: [{ spaceId: 'cipherstash', dirName: '0001_seed' }],
    });
    const extensionDir = join('db-migrations', 'cipherstash', '0001_seed');
    const fieldRows = (run.presented?.presentation.human ?? []).flatMap((block) =>
      block.kind === 'fields' ? block.rows : [],
    );
    expect(fieldRows).toContainEqual({ label: 'space cipherstash', value: extensionDir });
    expect(run.presented?.presentation.next?.at(0)).toMatchObject({
      kind: 'edit-file',
      label: expect.stringContaining(extensionDir),
    });
  });

  it('emits the total time only as a verbose message', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan'], { cwd: project.dir });

    expect(run.events).toContainEqual({
      kind: 'message',
      severity: 'verbose',
      text: expect.stringMatching(/^Total time: \d+ms$/),
    });
  });

  it('writes nothing to stdout in human mode', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.stdout).toBe('');
    expect(run.presented?.presentation.stdout).toEqual([]);
  });

  it('errors when the contract has not been emitted', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project, {
      overrides: {
        contract: {
          source: { format: 'typescript', inputs: [], load: async () => ({}) },
          output: join(project.dir, 'output', 'missing.json'),
        },
      },
    }).run(['migration', 'plan', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.FILE_NOT_FOUND' } },
    });
  });

  it('errors when the planner reports a conflict', async () => {
    const project = await plannableProject();

    const run = await harness(project, {
      script: { conflicts: [{ kind: 'unsupportedChange', summary: 'cannot narrow this column' }] },
    }).run(['migration', 'plan', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.PLANNING_FAILED' } },
    });
  });

  it('errors when --from names a hash outside the graph', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(
      ['migration', 'plan', '--from', `dead${'2'.repeat(60)}`, '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
    expect(envelope).toMatchObject({ ok: false });
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });
});
