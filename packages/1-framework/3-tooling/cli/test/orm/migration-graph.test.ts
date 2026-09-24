import { rm } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
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
  const dir = createTestProjectDir('orm-graph');
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
  'Only the operation count and class are read by the graph renderer'
>({
  id: 'schema.add_column',
  label: 'Add column',
  operationClass: 'additive',
});

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

function ormConfig(): Record<string, unknown> {
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
  };
}

async function seedMigration(migrationsDir: string): Promise<void> {
  const base = blindCast<
    Omit<MigrationMetadata, 'migrationHash'>,
    'The graph renderer reads from/to, createdAt and providedInvariants'
  >({ from: null, to: HASH_A, providedInvariants: [], createdAt: '2025-01-01T00:00:00.000Z' });
  const ops = [ADDITIVE_OP];
  const metadata: MigrationMetadata = { ...base, migrationHash: computeMigrationHash(base, ops) };
  await writeMigrationPackage(join(migrationsDir, 'app', MIGRATION_DIR), metadata, ops);
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands: BIN_COMMANDS, groups: BIN_GROUPS, orm: config });
}

describe('migration graph', () => {
  it('settles as a completed envelope carrying the graph document', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: true, exitCode: 0 } });
    expect(run.presented?.data).toMatchObject({
      ok: true,
      summary: '1 space(s), 2 contract(s), 1 migration(s)',
      spaces: [
        {
          space: 'app',
          contracts: [
            { hash: EMPTY_CONTRACT_HASH, refs: [] },
            { hash: HASH_A, refs: [] },
          ],
          migrations: [{ name: MIGRATION_DIR, fromContract: null, toContract: HASH_A }],
        },
      ],
    });
  });

  it('draws the tree as a toned drawing and puts nothing on stdout', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });
    const blocks = run.presented?.presentation.human ?? [];
    const drawing = blocks.at(-1);

    expect(blocks[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [{ label: 'migrations', value: 'migrations' }],
    });
    expect(drawing?.kind).toBe('drawing');
    expect(JSON.stringify(drawing)).toContain(MIGRATION_DIR);
    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(run.stdout).toBe('');
  });

  it('paints the drawing, keeping the tree aligned once colour is stripped', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr).split('\n');

    expect(run.stderr).toContain('\u001B[');
    expect(rendered).toContain('○   4cb4256');
    expect(rendered).toContain(`│↑  ${MIGRATION_DIR}        ∅ → 4cb4256  1 ops`);
  });

  it('puts the DOT text on stdout in human mode', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph', '--dot'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.presentation.stdout?.[0]).toBe('digraph migrations {');
    expect(run.presented?.presentation.stdout?.join('\n')).toContain(MIGRATION_DIR);
    expect(run.stdout).toContain('digraph migrations {');
  });

  it('draws the DOT as a human block, so one shared screen still shows it', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph', '--dot'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });
    const drawing = run.presented?.presentation.human.at(-1);

    expect(run.exitCode).toBe(0);
    expect(drawing?.kind).toBe('drawing');
    expect(JSON.stringify(drawing)).toContain('digraph migrations {');
    expect(stripAnsi(run.stderr)).toContain('digraph migrations {');
    expect(run.stdout).toBe('');
    expect(run.presented?.presentation.stdout?.[0]).toBe('digraph migrations {');
  });

  it('carries the DOT text on the json result alongside the graph document', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph', '--dot', '--json'], {
      cwd: dir,
    });
    const document = run.presented?.data as { dot: string; spaces: readonly unknown[] };

    expect(run.exitCode).toBe(0);
    expect(document.dot).toContain('digraph migrations {');
    expect(document.spaces).toHaveLength(1);
    expect(run.presented?.presentation.stdout).toEqual([]);
  });

  it('leaves the json document without a dot field when --dot is absent', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph', '--json'], {
      cwd: dir,
    });

    expect(run.presented?.data).not.toHaveProperty('dot');
  });

  it('rejects --legend with --dot', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(
      ['migration', 'graph', '--dot', '--legend', '--json'],
      {
        cwd: dir,
      },
    );
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.LEGEND_HUMAN_ONLY', meta: { conflictingFlag: '--dot' } },
    });
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
  });

  it('draws the glyph key when --legend is passed', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph', '--legend'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.presented?.presentation.human.at(-1)?.kind).toBe('drawing');
    expect(stripAnsi(run.stderr).split('\n')).toContain('Legend:');
  });

  it('errors with the dotted code when the space does not exist', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(
      ['migration', 'graph', '--space', 'nope', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.SPACE_NOT_FOUND' } },
    });
  });

  it('names the narrowed space in the human header', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'graph', '--space', 'app'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [
        { label: 'migrations', value: 'migrations' },
        { label: 'space', value: 'app' },
      ],
    });
  });
});
