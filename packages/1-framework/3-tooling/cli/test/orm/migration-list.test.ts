import { rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const HASH_A = `4cb4256${'0'.repeat(57)}`;

const dirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-list');
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
  'Only the operation count and class are read by the list renderer'
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
  const packageDir = join(migrationsDir, 'app', '20250101T0000_initial');
  const ops = [ADDITIVE_OP];
  const base = blindCast<
    Omit<MigrationMetadata, 'migrationHash'>,
    'The list renderer reads only from/to, createdAt and providedInvariants'
  >({ from: null, to: HASH_A, providedInvariants: [], createdAt: '2025-01-01T00:00:00.000Z' });
  const metadata: MigrationMetadata = { ...base, migrationHash: computeMigrationHash(base, ops) };
  await writeMigrationPackage(packageDir, metadata, ops);
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    orm: config,
  });
}

describe('migration list', () => {
  it('settles as a completed envelope carrying the list document', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    const terminal = run.json.at(-1);
    expect(terminal).toMatchObject({ kind: 'result', envelope: { ok: true, exitCode: 0 } });
  });

  it('reports the migration it found', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });
    const list = run.presented?.data as { spaces: ReadonlyArray<{ space: string }> };

    expect(list.spaces.map((entry) => entry.space)).toEqual(['app']);
  });

  it('draws the tree as toned spans rather than a pre-coloured string', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'fields',
        rail: true,
        rows: [{ label: 'migrations', value: 'migrations' }],
      },
      {
        kind: 'drawing',
        lines: [
          [
            { text: '○', tone: 'color-1' },
            { text: '   ' },
            { text: '4cb4256', tone: 'identifier' },
          ],
          [
            { text: '│↑', tone: 'color-1' },
            { text: '  ' },
            { text: '20250101T0000_initial', tone: 'color-1' },
            { text: '        ' },
            { text: '∅', tone: 'structure' },
            { text: ' ' },
            { text: '→', tone: 'structure' },
            { text: ' ' },
            { text: '4cb4256', tone: 'identifier' },
            { text: '  1 ops' },
          ],
          [{ text: '○', tone: 'color-1' }, { text: '   ' }, { text: '∅', tone: 'structure' }],
          '',
          [{ text: '1 migration(s) on disk', tone: 'muted' }],
        ],
      },
    ]);
  });

  it('carries no escape sequence of its own into the drawing', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(JSON.stringify(run.presented?.presentation.human)).not.toContain('\\u001b');
  });

  it('leaves stdout empty, having no machine-consumable lines to put there', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(run.stdout).toBe('');
  });

  it('renders the empty-project line when no migration is on disk', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['migration', 'list'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human.at(-1)).toEqual({
      kind: 'drawing',
      lines: [[{ text: 'There are no migrations in migrations/app/ yet', tone: 'muted' }]],
    });
  });

  it('drops the rendered table in json mode so stdout stays a frame stream', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list', '--json'], {
      cwd: dir,
    });

    expect(run.presented?.presentation.stdout).toEqual([]);
    for (const line of run.stdout.split('\n').filter((entry) => entry.length > 0)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('names the narrowed space in the human header', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list', '--space', 'app'], {
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

  it('draws the glyph key when --legend is passed, with no bullet glued on', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list', '--legend'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr).split('\n');

    expect(run.presented?.presentation.human.at(-1)?.kind).toBe('drawing');
    expect(rendered).toContain('Legend:');
    expect(rendered).toContain('  ○ contract   ↑ forward   ↓ rollback');
    expect(rendered.filter((line) => line.startsWith('- '))).toEqual([]);
    const legendText = rendered.join('\n');
    expect(legendText).toContain('@contract @db');
    expect(legendText).toContain('(prod, staging)');
    expect(legendText).toContain('reserved markers — also typeable as --from/--to tokens');
    expect(legendText).toContain('user-defined refs');
  });

  it('errors with the dotted code when the space does not exist', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list', '--space', 'nope', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.SPACE_NOT_FOUND' } },
    });
  });

  it('gives the errored envelope typed next actions and no fix prose', async () => {
    const dir = await projectDir();
    await seedMigration(join(dir, 'migrations'));

    const run = await harness(ormConfig()).run(['migration', 'list', '--space', 'nope', '--json'], {
      cwd: dir,
    });
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(envelope?.ok).toBe(false);
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });

  it('fails before the handler when the orm section is structurally invalid', async () => {
    const dir = await projectDir();

    const run = await harness({ migrations: { dir: 42 } }).run(['migration', 'list', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.CONFIG_SECTION_INVALID' } },
    });
  });

  it('resolves migrations against the run cwd, not the process cwd', async () => {
    const first = await projectDir();
    const second = await projectDir();
    await seedMigration(join(first, 'migrations'));
    await seedMigration(join(second, 'db'));
    const cli = harness(ormConfig());

    const runFirst = await cli.run(['migration', 'list'], {
      cwd: first,
      isTty: { stdout: true },
    });
    const runSecond = await harness({ ...ormConfig(), migrations: { dir: 'db' } }).run(
      ['migration', 'list'],
      { cwd: second, isTty: { stdout: true } },
    );

    expect(runFirst.presented?.presentation.human[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [{ label: 'migrations', value: 'migrations' }],
    });
    expect(runSecond.presented?.presentation.human[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [{ label: 'migrations', value: 'db' }],
    });
  });

  describe('the worked example from the slice spec', () => {
    const HASH_55bada2 = `55bada2${'0'.repeat(57)}`;
    const HASH_2f45cc7 = `2f45cc7${'0'.repeat(57)}`;
    const HASH_804e018 = `804e018${'0'.repeat(57)}`;
    const BACKFILL_OP = blindCast<
      MigrationPlanOperation,
      'The list renderer reads only the id, class and invariantId'
    >({
      id: 'data.backfill_emails',
      label: 'Backfill emails',
      operationClass: 'data',
      invariantId: 'backfill_emails_v1',
    });

    async function seedPackage(
      appDir: string,
      dirName: string,
      from: string | null,
      to: string,
      ops: readonly MigrationPlanOperation[],
      providedInvariants: readonly string[] = [],
    ): Promise<void> {
      const base = blindCast<
        Omit<MigrationMetadata, 'migrationHash'>,
        'The list renderer reads only from/to, createdAt and providedInvariants'
      >({ from, to, providedInvariants, createdAt: '2026-02-25T14:30:00.000Z' });
      const metadata: MigrationMetadata = {
        ...base,
        migrationHash: computeMigrationHash(base, ops),
      };
      await writeMigrationPackage(join(appDir, dirName), metadata, ops);
    }

    async function seedWorkedExample(dir: string): Promise<void> {
      const appDir = join(dir, 'migrations', 'app');
      await seedPackage(appDir, '20260422T0720_initial', null, HASH_A, [ADDITIVE_OP]);
      await seedPackage(appDir, '20260422T0742_migration', HASH_A, HASH_55bada2, [ADDITIVE_OP]);
      await seedPackage(appDir, '20260422T0748_migration', HASH_55bada2, HASH_2f45cc7, [
        ADDITIVE_OP,
      ]);
      await seedPackage(appDir, '20260518T1701_namespaces_bookend', HASH_2f45cc7, HASH_804e018, [
        ADDITIVE_OP,
      ]);
      await seedPackage(
        appDir,
        '20260601T1200_backfill_emails',
        HASH_55bada2,
        HASH_55bada2,
        [BACKFILL_OP],
        ['backfill_emails_v1'],
      );
      const refsDir = join(appDir, 'refs');
      await writeRef(refsDir, 'production', { hash: HASH_55bada2, invariants: [] });
      await writeRef(refsDir, 'staging', { hash: HASH_2f45cc7, invariants: [] });
      await writeRef(refsDir, 'db', { hash: HASH_804e018, invariants: [] });
    }

    it('lists newest-first with refs and invariants decorating their migrations', async () => {
      const dir = await projectDir();
      await seedWorkedExample(dir);

      const run = await harness(ormConfig()).run(['migration', 'list', '--json'], {
        cwd: dir,
      });
      const list = run.presented?.data as {
        summary: string;
        spaces: ReadonlyArray<{
          space: string;
          migrations: ReadonlyArray<{
            name: string;
            refs: readonly string[];
            providedInvariants: readonly string[];
          }>;
        }>;
      };

      expect(run.exitCode).toBe(0);
      expect(list.summary).toBe('5 migration(s) on disk');
      expect(list.spaces.map((entry) => entry.space)).toEqual(['app']);
      expect(list.spaces[0]?.migrations.map((migration) => migration.name)).toEqual([
        '20260601T1200_backfill_emails',
        '20260518T1701_namespaces_bookend',
        '20260422T0748_migration',
        '20260422T0742_migration',
        '20260422T0720_initial',
      ]);
      expect(list.spaces[0]?.migrations[0]).toMatchObject({
        name: '20260601T1200_backfill_emails',
        refs: ['production'],
        providedInvariants: ['backfill_emails_v1'],
      });
      expect(list.spaces[0]?.migrations[1]).toMatchObject({ refs: ['db'] });
      expect(list.spaces[0]?.migrations[2]).toMatchObject({ refs: ['staging'] });
    });

    it('decorates an extension tip migration with its head ref', async () => {
      const HASH_POSTGIS = `9aabbcc${'0'.repeat(57)}`;
      const dir = await projectDir();
      const postgisDir = join(dir, 'migrations', 'postgis');
      await seedPackage(postgisDir, '20260601T0000_install_postgis', null, HASH_POSTGIS, [
        ADDITIVE_OP,
      ]);
      await writeRef(join(postgisDir, 'refs'), 'head', { hash: HASH_POSTGIS, invariants: [] });
      await writeFile(
        join(postgisDir, 'contract.json'),
        JSON.stringify({
          storage: { storageHash: HASH_POSTGIS },
          schemaVersion: '1.0.0',
          target: 'postgres',
          targetFamily: 'sql',
        }),
      );

      const run = await harness(ormConfig()).run(['migration', 'list', '--json'], {
        cwd: dir,
      });
      const list = run.presented?.data as {
        spaces: ReadonlyArray<{
          space: string;
          migrations: ReadonlyArray<{ refs: readonly string[] }>;
        }>;
      };

      const postgisSpace = list.spaces.find((entry) => entry.space === 'postgis');
      expect(postgisSpace?.migrations[0]?.refs).toEqual(['head']);
    });
  });
});
