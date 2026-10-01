import { rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { blindCast } from '@internal/utils/casts';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const HASH_A = `4cb4256${'0'.repeat(57)}`;
const MIGRATION_DIR = '20250101T0000_initial';

const dirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-show');
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
  'The show renderer reads only id, label and operationClass'
>({
  id: 'schema.add_column',
  label: 'Add column',
  operationClass: 'additive',
});

/**
 * `migration show` deserializes the emitted contract through the family, so the
 * fake family hands the parsed JSON straight back and the aggregate loader
 * treats it as the app contract.
 */
function ormConfig(contractOutput = 'output/contract.json'): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({ deserializeContract: (json: unknown) => json }),
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
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: contractOutput,
    },
  };
}

async function seedProject(dir: string): Promise<void> {
  await writeFile(
    join(dir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: HASH_A }, target: 'postgres', targetFamily: 'sql' }),
    'utf-8',
  );
  const base = blindCast<
    Omit<MigrationMetadata, 'migrationHash'>,
    'The show presenter reads from/to, createdAt and the operations'
  >({ from: null, to: HASH_A, providedInvariants: [], createdAt: '2025-01-01T00:00:00.000Z' });
  const ops = [ADDITIVE_OP];
  const metadata: MigrationMetadata = { ...base, migrationHash: computeMigrationHash(base, ops) };
  await writeMigrationPackage(join(dir, 'migrations', 'app', MIGRATION_DIR), metadata, ops);
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    orm: config,
  });
}

describe('migration show', () => {
  it('settles as a completed envelope carrying the show document', async () => {
    const dir = await projectDir();
    await seedProject(dir);

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', MIGRATION_DIR, '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: true, exitCode: 0 },
    });
    expect(run.presented?.data).toEqual({
      ok: true,
      summary: `Migration ${MIGRATION_DIR} in app: 1 operation(s)`,
      migration: {
        space: 'app',
        name: MIGRATION_DIR,
        hash: expect.any(String),
        fromContract: null,
        toContract: HASH_A,
        createdAt: '2025-01-01T00:00:00.000Z',
        operations: [{ id: 'schema.add_column', label: 'Add column', operationClass: 'additive' }],
        preview: { statements: [] },
      },
    });
  });

  it('ships the rendered detail as the stdout presentation and the header as blocks', async () => {
    const dir = await projectDir();
    await seedProject(dir);

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', MIGRATION_DIR],
      {
        cwd: dir,
        isTty: { stdout: true },
      },
    );

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: 'contract.json' },
          { label: 'migrations', value: join('migrations', 'app') },
          { label: 'target', value: MIGRATION_DIR },
        ],
      },
      { kind: 'summary', status: 'ok', text: [{ text: MIGRATION_DIR, tone: 'emphasis' }] },
      {
        kind: 'fields',
        rows: [
          { label: 'from', value: [{ text: '(baseline)', tone: 'muted' }] },
          { label: 'to', value: [{ text: HASH_A, tone: 'identifier' }] },
          { label: 'hash', value: [{ text: expect.any(String), tone: 'identifier' }] },
          { label: 'created', value: [{ text: '2025-01-01T00:00:00.000Z', tone: 'muted' }] },
        ],
      },
      {
        kind: 'tree',
        roots: [{ label: '1 operation(s)', children: [{ label: 'Add column' }] }],
      },
    ]);
    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(run.stdout).toBe('');
  });

  it('drops blank preview statements and keeps multi-line statements unwrapped', async () => {
    const dir = await projectDir();
    await seedProject(dir);
    const config = ormConfig('contract.json');
    config['family'] = {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({
        deserializeContract: (json: unknown) => json,
        toOperationPreview: () => ({
          statements: [
            { text: '  CREATE TABLE "users" (\n    id integer\n  )  ', language: 'sql' },
            { text: '   ', language: 'sql' },
            { text: 'db.users.createIndex({ name: 1 })', language: 'mongodb-shell' },
          ],
        }),
      }),
    };

    const run = await harness(config).run(['migration', 'show', MIGRATION_DIR], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toContainEqual({
      kind: 'drawing',
      lines: ['CREATE TABLE "users" (\n    id integer\n  );', 'db.users.createIndex({ name: 1 })'],
    });
  });

  it('renders the operation tree under its heading', async () => {
    const dir = await projectDir();
    await seedProject(dir);

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', MIGRATION_DIR],
      { cwd: dir, isTty: { stdout: true, stderr: true } },
    );
    const rendered = stripAnsi(run.stderr).split('\n');

    expect(rendered).toContain('1 operation(s)');
    expect(rendered.some((line) => line.includes('Add column'))).toBe(true);
  });

  it('suffixes SQL preview statements with a semicolon and leaves other languages verbatim', async () => {
    const dir = await projectDir();
    await seedProject(dir);
    const config = ormConfig('contract.json');
    config['family'] = {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({
        deserializeContract: (json: unknown) => json,
        toOperationPreview: () => ({
          statements: [
            { text: 'CREATE TABLE t (id int)', language: 'sql' },
            { text: 'db.createCollection("t")', language: 'mongodb-shell' },
          ],
        }),
      }),
    };

    const run = await harness(config).run(['migration', 'show', MIGRATION_DIR], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr).split('\n');

    expect(rendered.some((line) => line.endsWith('CREATE TABLE t (id int);'))).toBe(true);
    expect(rendered.some((line) => line.endsWith('db.createCollection("t")'))).toBe(true);
    expect(rendered.some((line) => line.includes('db.createCollection("t");'))).toBe(false);
  });

  it('keeps stdout a frame stream in json mode', async () => {
    const dir = await projectDir();
    await seedProject(dir);

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', MIGRATION_DIR, '--json'],
      { cwd: dir },
    );

    expect(run.presented?.presentation.stdout).toEqual([]);
    for (const line of run.stdout.split('\n').filter((entry) => entry.length > 0)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('resolves a path target against the run cwd, not the process cwd', async () => {
    const dir = await projectDir();
    await seedProject(dir);

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', join('migrations', 'app', MIGRATION_DIR), '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ migration: { name: MIGRATION_DIR } });
  });

  it('refuses a path outside the app space', async () => {
    const dir = await projectDir();
    await seedProject(dir);

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', join('migrations', 'pgvector', '0001-init'), '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.TARGET_NOT_APP_SPACE' } },
    });
  });

  it('errors with the dotted code when the reference resolves to nothing', async () => {
    const dir = await projectDir();
    await seedProject(dir);

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', 'nonexistent123', '--json'],
      { cwd: dir },
    );
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({ ok: false, error: { code: 'MIGRATION.REF_NOT_FOUND' } });
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });

  it('reports no migrations when the app space is empty', async () => {
    const dir = await projectDir();
    await writeFile(
      join(dir, 'contract.json'),
      JSON.stringify({ storage: { storageHash: HASH_A }, target: 'postgres', targetFamily: 'sql' }),
      'utf-8',
    );

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', 'anything', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.NO_MIGRATIONS' } },
    });
  });

  it('errors when the emitted contract is missing', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig('contract.json')).run(
      ['migration', 'show', MIGRATION_DIR, '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.FILE_NOT_FOUND' } },
    });
  });

  it('requires a target', async () => {
    const dir = await projectDir();
    await seedProject(dir);

    const run = await harness(ormConfig('contract.json')).run(['migration', 'show', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).not.toBe(0);
  });
});
