import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { blindCast } from '@internal/utils/casts';
import type { PresentedResult } from '@prisma/cli-engine';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { createTestCli } from '@prisma/cli-engine/testing';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import type { MigrationCheckResult } from '../../src/commands/json/schemas';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const HASH_A = `4cb4256${'0'.repeat(57)}`;
const HASH_UNPRODUCED = `9f9f9f9${'1'.repeat(57)}`;

const dirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-check');
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const ADDITIVE_OP = blindCast<
  MigrationPlanOperation,
  'The integrity checks read only the operation list length and the metadata hashes'
>({ id: 'schema.add_column', label: 'Add column', operationClass: 'additive' });

const TEST_CONTRACT = createSqlContract({
  target: 'postgres',
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: { user: { columns: { id: {} } } } },
      },
    },
  },
});

function ormConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: {
      kind: 'target',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: () => ({}),
    },
    adapter: {
      kind: 'adapter',
      id: 'pg',
      familyId: 'sql',
      targetId: 'postgres',
      version: '1.0.0',
      create: () => ({}),
    },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => TEST_CONTRACT },
      output: 'output/contract.json',
    },
    ...overrides,
  };
}

async function seedMigration(
  migrationsDir: string,
  options: { readonly dirName?: string; readonly from?: string | null } = {},
): Promise<string> {
  const dirName = options.dirName ?? '20250101T0000_initial';
  const packageDir = join(migrationsDir, 'app', dirName);
  const ops = [ADDITIVE_OP];
  const base = blindCast<
    Omit<MigrationMetadata, 'migrationHash'>,
    'The integrity checks read from/to, createdAt and providedInvariants'
  >({
    from: options.from ?? null,
    to: HASH_A,
    providedInvariants: [],
    createdAt: '2025-01-01T00:00:00.000Z',
  });
  const metadata: MigrationMetadata = { ...base, migrationHash: computeMigrationHash(base, ops) };
  await writeMigrationPackage(packageDir, metadata, ops);
  return packageDir;
}

/** A directory the loader skips, whose manifest files are therefore missing. */
async function seedUnloadableDirectory(migrationsDir: string): Promise<void> {
  await mkdir(join(migrationsDir, 'app', '20250102T0000_broken'), { recursive: true });
}

/**
 * Rewrites a package's stored `migrationHash` so it disagrees with the hash
 * recomputed from the package contents.
 */
async function corruptStoredHash(packageDir: string): Promise<void> {
  const manifestPath = join(packageDir, 'migration.json');
  const manifest = blindCast<Record<string, unknown>, 'the manifest this test just wrote'>(
    JSON.parse(await readFile(manifestPath, 'utf-8')),
  );
  await writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, migrationHash: HASH_UNPRODUCED }, null, 2),
    'utf-8',
  );
}

async function seedDanglingRef(migrationsDir: string, name: string): Promise<void> {
  const refsDir = join(migrationsDir, 'app', 'refs');
  await mkdir(refsDir, { recursive: true });
  await writeFile(
    join(refsDir, `${name}.json`),
    JSON.stringify({ hash: HASH_UNPRODUCED, invariants: [] }),
    'utf-8',
  );
}

function harness(config: Record<string, unknown>) {
  return createTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, config: { orm: config } });
}

function diagnosticsOf(run: {
  readonly presented: PresentedResult<unknown> | undefined;
}): readonly Diagnostic[] {
  return run.presented?.diagnostics ?? [];
}

describe('migration check', () => {
  describe('a clean project', () => {
    it('completes at exit 0 with no diagnostics', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(['migration', 'check', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(0);
      expect(diagnosticsOf(run)).toEqual([]);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: { ok: true, exitCode: 0, diagnostics: [] },
      });
    });

    it('carries the unchanged check document', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(['migration', 'check', '--json'], {
        cwd: dir,
      });

      expect(run.presented?.data).toEqual({
        ok: true,
        failures: [],
        summary: 'All checks passed',
      });
    });

    it('heads the human output with the migrations directory and says it passed', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(['migration', 'check'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human).toEqual([
        { kind: 'fields', rail: true, rows: [{ label: 'migrations', value: 'migrations/app' }] },
        { kind: 'summary', status: 'ok', text: 'All checks passed' },
      ]);
      expect(run.presented?.presentation.stdout).toEqual([]);
      expect(run.stdout).toBe('');
    });
  });

  describe('integrity failures', () => {
    it('completes at exit 4 carrying one error diagnostic per failure', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));
      await seedUnloadableDirectory(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(['migration', 'check', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(4);
      expect(
        diagnosticsOf(run).map((diagnostic) => ({
          code: diagnostic.code,
          severity: diagnostic.severity,
        })),
      ).toEqual([
        { code: 'MIGRATION.CHECK_FILE_MISSING', severity: 'error' },
        { code: 'MIGRATION.CHECK_FILE_MISSING', severity: 'error' },
      ]);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: { ok: true, exitCode: 4 },
      });
    });

    it('points each diagnostic at the file it is about and keeps its next actions', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));
      await seedUnloadableDirectory(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(['migration', 'check', '--json'], {
        cwd: dir,
      });
      const [first] = diagnosticsOf(run);

      expect(first?.where).toEqual({
        path: 'migrations/app/20250102T0000_broken/migration.json',
      });
      expect(first?.meta).toEqual({ space: 'app' });
      expect(first?.nextActions).toEqual([
        {
          kind: 'user-choice',
          label: 'Re-emit the migration package, or restore it from version control',
        },
      ]);
    });

    it('reports a dangling ref under its own code', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));
      await seedDanglingRef(join(dir, 'migrations'), 'staging');

      const run = await harness(ormConfig()).run(['migration', 'check', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run).map((diagnostic) => diagnostic.code)).toEqual([
        'MIGRATION.CHECK_DANGLING_REF',
      ]);
    });

    it('reports an unreachable migration under its own code', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'), {
        dirName: '20250103T0000_orphan',
        from: HASH_UNPRODUCED,
      });

      const run = await harness(ormConfig()).run(['migration', 'check', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run).map((diagnostic) => diagnostic.code)).toEqual([
        'MIGRATION.CHECK_UNREACHABLE_MIGRATION',
      ]);
    });

    it('keeps the published json document, with typed next actions and no fix prose', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));
      await seedDanglingRef(join(dir, 'migrations'), 'staging');

      const run = await harness(ormConfig()).run(['migration', 'check', '--json'], {
        cwd: dir,
      });
      const document = run.presented?.data as MigrationCheckResult;

      expect(document.ok).toBe(false);
      expect(document.summary).toBe('1 integrity failure(s)');
      expect(document.failures).toEqual([
        {
          space: 'app',
          code: 'MIGRATION.CHECK_DANGLING_REF',
          where: 'migrations/app/refs/staging.json',
          why: `Ref "staging" points at ${HASH_UNPRODUCED} which does not exist in the migration graph`,
          nextActions: [
            {
              kind: 'run-command',
              label: 'Point the ref at a graph node',
              command: '{bin} migration ref set staging <valid-hash>',
            },
            { kind: 'user-choice', label: 'Or delete the ref' },
          ],
        },
      ]);
      expect(JSON.stringify(document)).not.toContain('"fix"');
    });

    it('names the migration package on the line the human renderer prints', async () => {
      const dir = await projectDir();
      const packageDir = await seedMigration(join(dir, 'migrations'));
      await corruptStoredHash(packageDir);

      const run = await harness(ormConfig()).run(['migration', 'check', '20250101T0000_initial'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.exitCode).toBe(4);
      expect(run.stderr).toContain('migrations/app/20250101T0000_initial/migration.json');
      expect(run.stderr).toContain('MIGRATION.CHECK_HASH_MISMATCH');
    });

    it('keeps the path in the diagnostic summary, where a hash mismatch has no other name', async () => {
      const dir = await projectDir();
      const packageDir = await seedMigration(join(dir, 'migrations'));
      await corruptStoredHash(packageDir);

      const run = await harness(ormConfig()).run(
        ['migration', 'check', '20250101T0000_initial', '--json'],
        { cwd: dir },
      );

      expect(diagnosticsOf(run)[0]).toMatchObject({
        code: 'MIGRATION.CHECK_HASH_MISMATCH',
        summary: expect.stringContaining(
          `migrations/app/20250101T0000_initial/migration.json: Stored hash ${HASH_UNPRODUCED} does not match recomputed hash`,
        ),
        where: { path: 'migrations/app/20250101T0000_initial/migration.json' },
      });
    });

    it('says how many failures it found in the human summary', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));
      await seedDanglingRef(join(dir, 'migrations'), 'staging');

      const run = await harness(ormConfig()).run(['migration', 'check'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human.at(-1)).toEqual({
        kind: 'summary',
        status: 'error',
        text: '1 integrity failure(s)',
      });
    });
  });

  describe('a single target', () => {
    it('checks the named package and completes at exit 0', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(
        ['migration', 'check', '20250101T0000_initial', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ ok: true, failures: [] });
    });

    it('names the target in the human header', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(['migration', 'check', '20250101T0000_initial'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human[0]).toEqual({
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'migrations', value: 'migrations/app' },
          { label: 'target', value: '20250101T0000_initial' },
        ],
      });
    });

    it('errors with a dotted code when the target names no package on disk', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(
        ['migration', 'check', './migrations/app/20250909T0000_absent', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: { ok: false, error: { code: 'MIGRATION.PACKAGE_NOT_FOUND' } },
      });
    });

    it('errors when the reference resolves against nothing', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(['migration', 'check', 'nope', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: {
          ok: false,
          error: {
            code: 'MIGRATION.REF_NOT_FOUND',
            meta: { input: 'nope', grammar: 'migration' },
          },
        },
      });
    });
  });

  describe('could not run the check', () => {
    it('errors at exit 2 when --space names no on-disk space', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(
        ['migration', 'check', '--space', 'nope', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: { ok: false, error: { code: 'MIGRATION.SPACE_NOT_FOUND' } },
      });
      expect(diagnosticsOf(run)).toEqual([]);
    });

    it('errors at exit 2 when --space is not a legal space id', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(
        ['migration', 'check', '--space', 'Not Legal', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: { ok: false, error: { code: 'MIGRATION.INVALID_SPACE_ID' } },
      });
    });

    it('gives every errored envelope typed next actions and no fix prose', async () => {
      const dir = await projectDir();
      await seedMigration(join(dir, 'migrations'));

      const run = await harness(ormConfig()).run(
        ['migration', 'check', '--space', 'nope', '--json'],
        { cwd: dir },
      );
      const terminal = run.json.at(-1);
      const envelope =
        terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

      expect(envelope?.nextActions.length).toBeGreaterThan(0);
      expect(envelope).not.toHaveProperty('fix');
    });
  });

  it('spells its exit codes in --help, which does not render the exitCodes map', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['migration', 'check', '--help'], {
      cwd: dir,
    });

    expect(`${run.stdout}${run.stderr}`).toContain('4 = integrity failure(s) found');
  });

  it('narrows to one space when --space is given', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));
    await seedDanglingRef(join(dir, 'migrations'), 'staging');

    const run = await harness(ormConfig()).run(['migration', 'check', '--space', 'app', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(4);
    expect(diagnosticsOf(run).map((diagnostic) => diagnostic.code)).toEqual([
      'MIGRATION.CHECK_DANGLING_REF',
    ]);
  });

  it('resolves migrations against the run cwd, not the process cwd', async () => {
    const first = await projectDir();
    const second = await projectDir();
    await seedMigration(join(first, 'migrations'));
    await seedMigration(join(second, 'db'));
    await seedDanglingRef(join(second, 'db'), 'staging');

    const clean = await harness(ormConfig()).run(['migration', 'check', '--json'], {
      cwd: first,
    });
    const dirty = await harness(ormConfig({ migrations: { dir: 'db' } })).run(
      ['migration', 'check', '--json'],
      { cwd: second },
    );

    expect(clean.exitCode).toBe(0);
    expect(dirty.exitCode).toBe(4);
  });
});
