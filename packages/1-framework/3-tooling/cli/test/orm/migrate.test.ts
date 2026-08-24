import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { notOk, ok } from '@internal/utils/result';
import type { EngineEvent, StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const mocks = {
  connect: vi.fn(),
  readAllMarkers: vi.fn(),
  migrate: vi.fn(),
  close: vi.fn(),
};

/** The command tree mounted over a control-client double instead of the real client. */
const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      readAllMarkers: mocks.readAllMarkers,
      migrate: mocks.migrate,
      close: mocks.close,
    }) as unknown as ControlClient,
);

const EMPTY = 'empty';
const C1 = '1'.repeat(64);
const C2 = '2'.repeat(64);
const TARGET = 'mock';
const FAMILY = 'mock';

const OPS: readonly MigrationPlanOperation[] = [
  { id: 'relation.users', label: 'Create relation users', operationClass: 'additive' },
];

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writePackage(
  dir: string,
  base: Omit<MigrationMetadata, 'migrationHash'>,
): Promise<string> {
  const dirName = `20260101_10000${base.from === EMPTY ? '0' : '1'}_${base.to.slice(0, 6)}`;
  const metadata: MigrationMetadata = {
    ...base,
    migrationHash: computeMigrationHash(base, [...OPS]),
  };
  await writeMigrationPackage(join(dir, dirName), metadata, [...OPS]);
  return dirName;
}

/** A linear app history: empty → C1 → C2, with the emitted contract at C2. */
async function buildProject(): Promise<string> {
  const cwd = createTestProjectDir('orm-migrate');
  tempDirs.push(cwd);
  const appDir = join(cwd, 'migrations', 'app');
  await mkdir(appDir, { recursive: true });
  await writePackage(appDir, {
    from: EMPTY,
    to: C1,
    providedInvariants: [],
    createdAt: '2026-01-01T10:00:00.000Z',
  });
  await writePackage(appDir, {
    from: C1,
    to: C2,
    providedInvariants: [],
    createdAt: '2026-01-01T10:01:00.000Z',
  });
  await writeFile(
    join(cwd, 'contract.json'),
    JSON.stringify({
      storage: { storageHash: C2, namespaces: {} },
      schemaVersion: '1.0.0',
      target: TARGET,
      targetFamily: FAMILY,
    }),
  );
  return cwd;
}

function ormConfig(cwd: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: FAMILY,
      familyId: FAMILY,
      version: '1.0.0',
      emission: {},
      create: () => ({ deserializeContract: (json: unknown) => json }),
    },
    target: {
      kind: 'target',
      id: TARGET,
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
      migrations: {},
    },
    adapter: {
      kind: 'adapter',
      id: 'mock',
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
    },
    driver: {
      kind: 'driver',
      id: 'mock',
      familyId: FAMILY,
      targetId: TARGET,
      version: '1.0.0',
      create: () => ({}),
    },
    db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: join(cwd, 'contract.json'),
    },
    migrations: { dir: 'migrations' },
    ...overrides,
  };
}

function appliedSuccess(): Record<string, unknown> {
  return {
    migrationsApplied: 2,
    markerHash: C2,
    applied: [
      {
        spaceId: 'app',
        dirName: '20260101_100000_111111',
        migrationHash: 'h1',
        from: EMPTY,
        to: C1,
        operationsExecuted: 1,
      },
    ],
    summary: 'Applied 2 migration(s)',
    perSpace: [
      {
        spaceId: 'app',
        kind: 'app',
        operations: [
          { id: 'relation.users', label: 'Create relation users', operationClass: 'additive' },
        ],
        marker: { storageHash: C2 },
      },
    ],
  };
}

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.readAllMarkers.mockReset().mockResolvedValue(new Map());
  mocks.migrate.mockReset().mockResolvedValue(ok(appliedSuccess()));
});

function harness(config: Record<string, unknown>) {
  return createTestCli({ commands, groups: BIN_GROUPS, config: { orm: config } });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

function stepEvents(events: readonly EngineEvent[]): readonly EngineEvent[] {
  return events.filter((event) => event.kind === 'step-started' || event.kind === 'step-finished');
}

describe('migrate', () => {
  it('settles as a completed envelope carrying the apply document', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      migrationsApplied: 2,
      migrationsTotal: 1,
      markerHash: C2,
      summary: 'Applied 2 migration(s)',
      advancedRef: null,
    });
  });

  it('reports the control API`s spans as step events rather than printing them', async () => {
    const cwd = await buildProject();
    mocks.migrate.mockImplementation(
      (options: { onProgress?: (event: Record<string, unknown>) => void }) => {
        options.onProgress?.({
          action: 'migrate',
          kind: 'spanStart',
          spanId: 'app',
          label: 'Applying app space',
        });
        options.onProgress?.({ action: 'migrate', kind: 'spanEnd', spanId: 'app', outcome: 'ok' });
        return Promise.resolve(ok(appliedSuccess()));
      },
    );

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(stepEvents(run.events)).toEqual([
      { kind: 'step-started', step: 'Applying app space', id: 'app' },
      { kind: 'step-finished', step: 'Applying app space', id: 'app', outcome: 'ok' },
    ]);
  });

  it('lays the applied spaces out as a tree the engine draws', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate'], {
      cwd,
      isTty: { stdout: true },
    });
    const blocks = run.presented?.presentation.human ?? [];

    expect(blocks[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [
        { label: 'migrations', value: 'migrations' },
        { label: 'database', value: 'postgres://****:****@localhost:5432/appdb' },
      ],
    });
    expect(blocks[1]).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'Applied 2 migration(s)',
    });
    expect(blocks[2]).toEqual({
      kind: 'tree',
      roots: [
        {
          label: [{ text: 'App space', tone: 'identifier' }],
          children: [
            { label: 'Create relation users' },
            {
              label: [
                { text: 'marker ', tone: 'muted' },
                { text: C2, tone: 'identifier' },
              ],
            },
          ],
        },
      ],
    });
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Check every space against the database',
        command: '{bin} migration status',
      },
    ]);
  });

  it('writes nothing to stdout in human mode', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate'], {
      cwd,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.stdout).toBe('');
    expect(stripAnsi(run.stderr)).toContain('Applied 2 migration(s)');
  });

  it('takes the connection from --db over the config', async () => {
    const cwd = await buildProject();

    await harness(ormConfig(cwd)).run(['db', 'migrate', '--db', 'postgres://other/db', '--json'], {
      cwd,
    });

    expect(mocks.connect).toHaveBeenCalledWith('postgres://other/db');
  });

  it('errors when no connection is configured', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd, { db: undefined })).run(['db', 'migrate', '--json'], {
      cwd,
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' },
    });
  });

  it('errors when the target has no migration runner', async () => {
    const cwd = await buildProject();
    const config = ormConfig(cwd);
    const run = await harness({
      ...config,
      target: { ...(config['target'] as Record<string, unknown>), migrations: undefined },
    }).run(['db', 'migrate', '--json'], { cwd });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.TARGET_UNSUPPORTED' },
    });
  });

  it('maps an unreachable path to its migration code', async () => {
    const cwd = await buildProject();
    mocks.migrate.mockResolvedValue(
      notOk({
        code: 'MIGRATION_PATH_NOT_FOUND',
        summary: 'no path',
        why: 'no recorded path',
        meta: { fromHash: '<empty>', targetHash: C2 },
      }),
    );

    const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.PATH_UNREACHABLE' },
    });
  });

  describe('a close that fails on the way out', () => {
    it('reports the connection failure rather than the failure to hang up', async () => {
      const cwd = await buildProject();
      mocks.connect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
      mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).toContain('ECONNREFUSED 127.0.0.1:5432');
      expect(settled).not.toContain('close on an unconnected client');
    });

    it('does not turn a successful apply into a failure', async () => {
      const cwd = await buildProject();
      mocks.close.mockRejectedValue(new Error('close failed'));

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--json'], { cwd });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({ ok: true });
    });
  });

  describe('--show', () => {
    it('previews the route without applying anything', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show', '--json'], {
        cwd,
      });

      expect(run.exitCode).toBe(0);
      expect(mocks.migrate).not.toHaveBeenCalled();
      expect(run.presented?.data).toMatchObject({
        ok: true,
        migrations: [
          expect.objectContaining({ spaceId: 'app', from: EMPTY, to: C1 }),
          expect.objectContaining({ spaceId: 'app', from: C1, to: C2 }),
        ],
      });
    });

    it('keeps the human-only rendering out of the result document', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show', '--json'], {
        cwd,
      });

      expect(Object.keys(run.presented?.data ?? {}).sort()).toEqual([
        'migrations',
        'ok',
        'summary',
      ]);
    });

    it('ships the topology as a drawing whose spans carry tone', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show'], {
        cwd,
        isTty: { stdout: true },
      });
      const blocks = run.presented?.presentation.human ?? [];
      const drawings = blocks.filter((block) => block.kind === 'drawing');

      expect(blocks[0]).toMatchObject({ kind: 'fields', rail: true });
      expect(drawings).toHaveLength(2);
      expect(JSON.stringify(drawings)).not.toContain('\\u001b');
      expect(JSON.stringify(drawings)).toContain('"tone"');
    });

    it('announces how many migrations will run', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show'], {
        cwd,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human).toContainEqual({
        kind: 'summary',
        status: 'info',
        text: 'The following 2 migrations will run:',
      });
    });

    it('keeps every arrow in the run list in one column', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show'], {
        cwd,
        isTty: { stdout: true, stderr: true },
      });
      const rendered = stripAnsi(run.stderr).split('\n');
      const runList = rendered.slice(rendered.findIndex((line) => line.includes('will run:')) + 1);
      const arrowColumns = new Set(
        runList.filter((line) => line.includes('\u2192')).map((line) => line.indexOf('\u2192')),
      );

      expect(run.stdout).toBe('');
      expect(runList.filter((line) => line.includes('\u2192'))).toHaveLength(2);
      expect(arrowColumns.size).toBe(1);
    });

    it('plans offline when --from names a contract', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--from', C1, '--json'],
        {
          cwd,
        },
      );

      expect(run.exitCode).toBe(0);
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(run.presented?.data).toMatchObject({
        migrations: [expect.objectContaining({ from: C1, to: C2 })],
      });
    });

    it('names the from-state and the target in the header', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--from', C1, '--to', C2],
        {
          cwd,
          isTty: { stdout: true },
        },
      );

      expect(run.presented?.presentation.human[0]).toEqual({
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'migrations', value: 'migrations' },
          { label: 'from', value: C1 },
          { label: 'to', value: C2 },
        ],
      });
    });
  });
});
