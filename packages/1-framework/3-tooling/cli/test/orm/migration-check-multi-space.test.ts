import { readFile, writeFile } from 'node:fs/promises';
import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import type { MigrationCheckResult } from '../../src/commands/json/schemas';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  contractJson,
  createOfflineProject,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  seedContractSnapshot,
  seedMigrationPackage,
} from './fixtures/offline-project';

afterEach(removeOfflineProjects);

const HASH_APP = `${'a'.repeat(64)}`;
const HASH_EXT = `${'b'.repeat(64)}`;
const HASH_DANGLING = `${'c'.repeat(64)}`;
const MALFORMED_HASH = 'not-a-sha256-hash';

/**
 * The postgis space must be a declared extension: an undeclared
 * `migrations/<space>/` directory is itself an integrity failure
 * (MIGRATION.CHECK_ORPHAN_SPACE_DIR).
 */
function postgisExtension(): Record<string, unknown> {
  return {
    kind: 'extension',
    id: 'postgis',
    familyId: 'sql',
    targetId: 'postgres',
    version: '1.0.0',
    create: () => ({}),
    contractSpace: {
      contractJson: contractJson(HASH_EXT),
      headRef: { hash: HASH_EXT, invariants: [] },
      migrations: [],
    },
  };
}

function harness(project: OfflineProject, options: { readonly declared?: boolean } = {}) {
  const base = offlineConfig({ project });
  const config = options.declared === false ? base : { ...base, extensions: [postgisExtension()] };
  return createOrmTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, orm: config });
}

async function seedHeadRef(spaceDir: string, hash: string): Promise<void> {
  await writeRef(join(spaceDir, 'refs'), 'head', { hash, invariants: [] });
}

/** A project with one migration in the app space and one in a postgis space. */
async function twoSpaceProject(options: {
  readonly appDirName?: string;
  readonly extDirName?: string;
}): Promise<OfflineProject & { readonly extMigrationsDir: string }> {
  const project = await createOfflineProject({ storageHash: HASH_APP });
  const extMigrationsDir = join(project.migrationsDir, 'postgis');
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: options.appDirName ?? '20260101T0000_app_init',
    from: null,
    to: HASH_APP,
  });
  await seedMigrationPackage({
    appMigrationsDir: extMigrationsDir,
    dirName: options.extDirName ?? '20260601T0000_install_postgis',
    from: null,
    to: HASH_EXT,
  });
  await seedHeadRef(extMigrationsDir, HASH_EXT);
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_EXT });
  return { ...project, extMigrationsDir };
}

async function seedDanglingRef(spaceDir: string): Promise<void> {
  await writeRef(join(spaceDir, 'refs'), 'broken', { hash: HASH_DANGLING, invariants: [] });
}

async function corruptStoredHash(packageDir: string): Promise<void> {
  const manifestPath = join(packageDir, 'migration.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
  await writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, migrationHash: `${'f'.repeat(64)}` }, null, 2),
    'utf-8',
  );
}

function documentOf(run: { readonly presented: { readonly data: unknown } | undefined }) {
  return run.presented?.data as MigrationCheckResult;
}

describe('migration check across spaces', () => {
  it('surfaces a dangling ref planted in a non-app space on the no-arg check', async () => {
    const project = await twoSpaceProject({});
    await seedDanglingRef(project.extMigrationsDir);

    const run = await harness(project).run(['migration', 'check', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(4);
    const failures = documentOf(run).failures.filter(
      (failure) => failure.code === 'MIGRATION.CHECK_DANGLING_REF',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.space).toBe('postgis');
    expect(failures[0]?.where).toContain('postgis');
    expect(failures[0]?.where).toContain('broken');
  });

  it('passes a clean multi-space tree with no failures', async () => {
    const project = await twoSpaceProject({});
    await writeRef(join(project.extMigrationsDir, 'refs'), 'db', {
      hash: HASH_EXT,
      invariants: [],
    });

    const run = await harness(project).run(['migration', 'check', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(documentOf(run)).toEqual({ ok: true, failures: [], summary: 'All checks passed' });
  });

  it('surfaces an unreachable migration planted in a non-app space', async () => {
    const project = await createOfflineProject({ storageHash: HASH_APP });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_app_init',
      from: null,
      to: HASH_APP,
    });
    const extMigrationsDir = join(project.migrationsDir, 'postgis');
    await seedMigrationPackage({
      appMigrationsDir: extMigrationsDir,
      dirName: '20260101T0000_orphan',
      from: HASH_DANGLING,
      to: HASH_EXT,
    });
    await seedHeadRef(extMigrationsDir, HASH_EXT);
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_EXT });

    const run = await harness(project).run(['migration', 'check', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(4);
    const unreachable = documentOf(run).failures.filter(
      (failure) => failure.code === 'MIGRATION.CHECK_UNREACHABLE_MIGRATION',
    );
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0]?.where).toContain('postgis');
  });

  it('narrows --space postgis to that space when both spaces carry a dangling ref', async () => {
    const project = await twoSpaceProject({});
    await seedDanglingRef(project.appMigrationsDir);
    await seedDanglingRef(project.extMigrationsDir);

    const run = await harness(project).run(['migration', 'check', '--space', 'postgis', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(4);
    const failures = documentOf(run).failures.filter(
      (failure) => failure.code === 'MIGRATION.CHECK_DANGLING_REF',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.space).toBe('postgis');
  });

  it('narrows --space app so extension failures never contaminate the app check', async () => {
    const project = await twoSpaceProject({});
    await seedDanglingRef(project.appMigrationsDir);
    await seedDanglingRef(project.extMigrationsDir);

    const run = await harness(project).run(['migration', 'check', '--space', 'app', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(4);
    const failures = documentOf(run).failures.filter(
      (failure) => failure.code === 'MIGRATION.CHECK_DANGLING_REF',
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.space).toBe('app');
  });

  it('keeps an app-space hash mismatch out of a check narrowed to another space', async () => {
    const project = await twoSpaceProject({ appDirName: '20260101T0000_app_init' });
    await corruptStoredHash(join(project.appMigrationsDir, '20260101T0000_app_init'));

    const narrowed = await harness(project).run(
      ['migration', 'check', '--space', 'postgis', '--json'],
      { cwd: project.dir },
    );
    const whole = await harness(project).run(['migration', 'check', '--json'], {
      cwd: project.dir,
    });

    expect(narrowed.exitCode).toBe(0);
    expect(documentOf(narrowed).failures).toEqual([]);
    expect(whole.exitCode).toBe(4);
    expect(
      documentOf(whole).failures.filter(
        (failure) => failure.code === 'MIGRATION.CHECK_HASH_MISMATCH' && failure.space === 'app',
      ),
    ).toHaveLength(1);
  });
});

describe('migration check with a single target across spaces', () => {
  it('resolves a dirName ref living in a non-app space', async () => {
    const project = await twoSpaceProject({});

    const run = await harness(project).run(
      ['migration', 'check', '20260601T0000_install_postgis', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(documentOf(run)).toMatchObject({ ok: true, failures: [] });
  });

  it('resolves the target inside the named space under --space', async () => {
    const project = await twoSpaceProject({});

    const run = await harness(project).run(
      ['migration', 'check', '20260601T0000_install_postgis', '--space', 'postgis', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(documentOf(run)).toMatchObject({ ok: true });
  });

  it('errors when --space narrows to a space that does not hold the target', async () => {
    const project = await twoSpaceProject({});

    const run = await harness(project).run(
      ['migration', 'check', '20260601T0000_install_postgis', '--space', 'app', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: false } });
  });

  it('errors on a dirName that resolves in two spaces, telling the user to qualify with --space', async () => {
    const project = await twoSpaceProject({
      appDirName: '20260101T0000_shared_name',
      extDirName: '20260101T0000_shared_name',
    });

    const run = await harness(project).run(
      ['migration', 'check', '20260101T0000_shared_name', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.AMBIGUOUS_MIGRATION_REF' },
    });
    expect(JSON.stringify(envelope)).toContain('--space');
  });

  it('rejects a contract ref name as a migration target', async () => {
    const project = await twoSpaceProject({});
    await writeRef(join(project.extMigrationsDir, 'refs'), 'db', {
      hash: HASH_EXT,
      invariants: [],
    });

    const run = await harness(project).run(
      ['migration', 'check', 'db', '--space', 'postgis', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: false } });
  });

  it('reports the wrong-grammar failure over an earlier space answering not-found', async () => {
    const project = await twoSpaceProject({});
    await writeRef(join(project.extMigrationsDir, 'refs'), 'dbref', {
      hash: HASH_EXT,
      invariants: [],
    });

    const run = await harness(project).run(['migration', 'check', 'dbref', '--json'], {
      cwd: project.dir,
    });
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
    const meta = envelope !== undefined && envelope.ok === false ? (envelope.error.meta ?? {}) : {};

    expect(run.exitCode).toBe(2);
    expect(meta['expectedGrammar']).toBeDefined();
    expect(meta['grammar']).toBeUndefined();
  });
});

describe('migration check with a path target', () => {
  it('resolves and checks a migration package by directory path', async () => {
    const project = await twoSpaceProject({});

    const run = await harness(project).run(
      ['migration', 'check', './migrations/app/20260101T0000_app_init', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(documentOf(run)).toMatchObject({ ok: true, failures: [] });
  });

  it('errors on a path naming no package on disk', async () => {
    const project = await twoSpaceProject({});

    const run = await harness(project).run(
      ['migration', 'check', join(project.migrationsDir, 'cipherstash', '00001_init'), '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: false } });
  });
});

describe('migration check snapshot consistency', () => {
  it('reports a malformed metadata.to as a failure rather than crashing', async () => {
    const project = await createOfflineProject({ storageHash: HASH_APP });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_init',
      from: null,
      to: MALFORMED_HASH,
    });

    const run = await harness(project, { declared: false }).run(['migration', 'check', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(4);
    const failure = documentOf(run).failures.find(
      (candidate) => candidate.code === 'MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE',
    );
    expect(failure).toBeDefined();
    expect(failure?.why).toContain(MALFORMED_HASH);
  });
});
