import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { notOk } from '@internal/utils/result';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import {
  contractJson,
  createOfflineProject,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  RENDERED_CONTRACT_DTS,
  removeOfflineProjects,
  renderContractDtsMock,
  resetRenderContractDtsMock,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;
const HASH_OTHER = `dead${'2'.repeat(60)}`;

/** Two migrations planned off the empty database: HASH_FROM and HASH_OTHER are both tips. */
async function forkedProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_left',
    from: null,
    to: HASH_FROM,
  });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260102T0000_right',
    from: null,
    to: HASH_OTHER,
  });
  return project;
}

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function harness(project: OfflineProject, overrides: Record<string, unknown> = {}) {
  return createTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    config: { orm: { ...offlineConfig({ project }), ...overrides } },
  });
}

async function scaffoldedDirs(project: OfflineProject): Promise<readonly string[]> {
  return (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs').sort();
}

describe('migration new', () => {
  it('settles as a completed envelope carrying the scaffold document', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'new', '--name', 'split-name'], {
      cwd: project.dir,
    });
    const dirs = await scaffoldedDirs(project);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      ok: true,
      dir: join('migrations', 'app', dirs[0] ?? ''),
      from: null,
      to: HASH_TO,
      summary: `Scaffolded migration at ${join('migrations', 'app', dirs[0] ?? '')}`,
    });
    expect(run.presented?.diagnostics).toEqual([]);
  });

  it('writes the package, its stub and the destination snapshot', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    await harness(project).run(['migration', 'new'], { cwd: project.dir });
    const [dirName] = await scaffoldedDirs(project);
    const packageDir = join(project.appMigrationsDir, dirName ?? '');

    expect(dirName).toMatch(/_migration$/);
    expect(await readFile(join(packageDir, 'migration.ts'), 'utf-8')).toBe('// empty migration\n');
    expect(JSON.parse(await readFile(join(packageDir, 'ops.json'), 'utf-8'))).toEqual([]);
    expect(
      await readFile(join(project.migrationsDir, 'snapshots', HASH_TO, 'contract.json'), 'utf-8'),
    ).toContain(HASH_TO);
  });

  it('presents the scaffold as a header, a confirmation and the contract edge', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'new'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });
    const [dirName] = await scaffoldedDirs(project);
    const dir = join('migrations', 'app', dirName ?? '');

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: join('output', 'contract.json') },
          { label: 'migrations', value: join('migrations', 'app') },
        ],
      },
      { kind: 'summary', status: 'ok', text: `Scaffolded migration at ${dir}` },
      {
        kind: 'fields',
        rows: [
          { label: 'from', value: [{ text: '(baseline)', tone: 'muted' }] },
          { label: 'to', value: [{ text: HASH_TO, tone: 'identifier' }] },
        ],
      },
    ]);
  });

  it('names editing and running the stub as the typed next actions', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'new'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });
    const [dirName] = await scaffoldedDirs(project);
    const migrationTs = join('migrations', 'app', dirName ?? '', 'migration.ts');

    expect(run.presented?.presentation.next).toEqual([
      { kind: 'edit-file', label: `Write the migration body in ${migrationTs}` },
      {
        kind: 'run-command',
        label: 'Run it to self-emit ops.json and attest the package',
        command: `node "${migrationTs}"`,
      },
    ]);
  });

  it('writes nothing to stdout in human mode', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'new'], {
      cwd: project.dir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.stdout).toBe('');
    expect(run.presented?.presentation.stdout).toEqual([]);
  });

  it('takes the db ref as the origin when --from is absent', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project).run(['migration', 'new', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ from: HASH_FROM, to: HASH_TO });
  });

  it('refuses without --from when migrations exist but no db ref names the origin', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });

    const run = await harness(project).run(['migration', 'new', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.PLAN_ORIGIN_UNKNOWN' } },
    });
    expect(await scaffoldedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('scaffolds from the db ref on a forked graph', async () => {
    const project = await forkedProject();
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project).run(['migration', 'new', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ from: HASH_FROM, to: HASH_TO });
  });

  it('refuses on a forked graph without a db ref', async () => {
    const project = await forkedProject();

    const run = await harness(project).run(['migration', 'new', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.PLAN_ORIGIN_UNKNOWN' } },
    });
  });

  it('refuses a db ref on an empty graph instead of scaffolding from nothing', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project).run(['migration', 'new', '--json'], {
      cwd: project.dir,
    });

    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.HASH_NOT_IN_GRAPH',
        meta: { refName: 'db', resolvedHash: HASH_FROM },
      },
      nextActions: [{ kind: 'user-choice', label: expect.stringContaining('migration plan') }],
    });
    expect(await scaffoldedDirs(project)).toEqual([]);
  });

  it('refuses a db ref that is not a graph node', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_OTHER });

    const run = await harness(project).run(['migration', 'new', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH' } },
    });
  });

  it('matches --from against a migration target by prefix', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });

    const run = await harness(project).run(['migration', 'new', '--from', 'beef1', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ from: HASH_FROM });
  });

  it('errors when --from is passed on an empty migrations directory', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'new', '--from', 'beef1', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH' },
    });
    expect(existsSync(project.appMigrationsDir)).toBe(false);
  });

  it('errors when --from is a prefix of several migration targets', async () => {
    const otherHash = `beef${'2'.repeat(60)}`;
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260102T0000_second',
      from: HASH_FROM,
      to: otherHash,
    });

    const run = await harness(project).run(['migration', 'new', '--from', 'beef', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
    expect(envelope).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.REF_AMBIGUOUS',
        meta: { input: 'beef', candidates: [HASH_FROM, otherHash] },
      },
    });
    expect(await scaffoldedDirs(project)).toEqual([
      '20260101T0000_initial',
      '20260102T0000_second',
    ]);
  });

  it('treats --from "" as a prefix, not as an absent flag', async () => {
    const otherHash = `f00d${'4'.repeat(60)}`;
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260102T0000_second',
      from: HASH_FROM,
      to: otherHash,
    });

    const run = await harness(project).run(['migration', 'new', '--from', '', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.REF_AMBIGUOUS' } },
    });
  });

  it('accepts a prefix shared only by packages with the same target hash', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_left',
      from: null,
      to: HASH_FROM,
    });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260102T0000_right',
      from: HASH_TO,
      to: HASH_FROM,
    });

    const run = await harness(project).run(['migration', 'new', '--from', 'beef', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ from: HASH_FROM });
  });

  it('errors when --from matches no migration target', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });

    const run = await harness(project).run(['migration', 'new', '--from', 'nope', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH' } },
    });
  });

  it('refuses when the contract already matches the db ref', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_TO,
    });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'new', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.NO_CHANGES' } },
    });
  });

  it('scaffolds on the current hash when --from names it explicitly', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_TO,
    });

    const run = await harness(project).run(['migration', 'new', '--from', HASH_TO, '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ from: HASH_TO, to: HASH_TO });
  });

  it('errors when the contract has not been emitted', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project, {
      contract: {
        source: { format: 'typescript', inputs: [], load: async () => ({}) },
        output: join(project.dir, 'output', 'missing.json'),
      },
    }).run(['migration', 'new', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.FILE_NOT_FOUND' } },
    });
  });

  it('errors when the target ships no migration support', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project, {
      ...offlineConfig({ project, targetSupportsMigrations: false }),
    }).run(['migration', 'new', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.TARGET_UNSUPPORTED' } },
    });
  });

  it('settles every error with typed next actions and no fix prose', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_TO,
    });

    const run = await harness(project).run(['migration', 'new', '--json'], {
      cwd: project.dir,
    });
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });
});

describe('migration new destination snapshot', () => {
  it('writes the destination snapshot with declarations rendered from the emitted contract', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'new', '--name', 'rendered', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(renderContractDtsMock).toHaveBeenCalledWith({
      contract: contractJson(HASH_TO),
      resolveImportSpecifier: expect.any(Function),
    });
    const storeDir = contractSnapshotDir(project.migrationsDir, HASH_TO);
    expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(RENDERED_CONTRACT_DTS);
  });

  it('refuses before writing anything when the declarations cannot be rendered', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    renderContractDtsMock.mockResolvedValue(
      notOk({
        code: 'RENDER_FAILED',
        summary: 'Failed to render contract types',
        why: 'relation author must declare nullability',
      }),
    );

    const run = await harness(project).run(['migration', 'new', '--name', 'refused', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONTRACT.TYPES_RENDER_FAILED' } },
    });
    expect(existsSync(project.appMigrationsDir)).toBe(false);
    expect(existsSync(contractSnapshotDir(project.migrationsDir, HASH_TO))).toBe(false);
  });
});
