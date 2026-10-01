import type { LedgerEntryRecord } from '@internal/contract/types';
import type { MountedTree } from '@prisma/cli-engine';
import { timeouts } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BIN_GROUPS as BinGroups } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  readLedger: vi.fn(),
}));

vi.mock('../../src/control-api/client', () => ({
  createControlClient: vi.fn(() => ({
    connect: mocks.connect,
    readLedger: mocks.readLedger,
    close: mocks.close,
  })),
}));

/**
 * The command tree is imported after the module registry is reset, so the
 * mocked client is the one `migration log` closes over. Repo-wide vitest runs
 * with `isolate: false`, and another file that loaded the command tree first
 * would otherwise have baked the real client into it.
 */
let commands: MountedTree;
let groups: typeof BinGroups;

beforeAll(async () => {
  vi.resetModules();
  const cli = await import('../../src/orm/cli');
  commands = cli.BIN_COMMANDS;
  groups = cli.BIN_GROUPS;
}, timeouts.coldTransformImport);

afterAll(() => {
  // The `vi.mock` leaks into the next file in the same worker; unmock and
  // reset so the next file loads the real client.
  vi.doUnmock('../../src/control-api/client');
  vi.resetModules();
});

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.readLedger.mockReset().mockResolvedValue([]);
});

const DESCRIPTOR = {
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
  create: () => ({}),
};

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
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
    ...overrides,
  };
}

function ledgerEntry(overrides: Partial<LedgerEntryRecord> = {}): LedgerEntryRecord {
  return {
    space: 'app',
    migrationName: '20260601T0800_initial',
    migrationHash: 'mig-hash',
    from: null,
    to: 'dest-hash',
    appliedAt: new Date('2026-06-01T08:00:00.000Z'),
    operationCount: 3,
    ...overrides,
  };
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups, orm: config });
}

describe('migration log', () => {
  it('settles as a completed envelope carrying the ledger document', async () => {
    mocks.readLedger.mockResolvedValue([ledgerEntry()]);

    const run = await harness(ormConfig()).run(['migration', 'log', '--json'], {
      cwd: '/tmp',
    });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: true, exitCode: 0 } });
    expect(run.presented?.data).toEqual({
      ok: true,
      summary: '1 migration(s) applied',
      records: [
        {
          space: 'app',
          name: '20260601T0800_initial',
          hash: 'mig-hash',
          fromContract: null,
          toContract: 'dest-hash',
          appliedAt: '2026-06-01T08:00:00.000Z',
          operationCount: 3,
        },
      ],
    });
  });

  it('ships the ledger as a table the engine sizes, masking the database', async () => {
    mocks.readLedger.mockResolvedValue([ledgerEntry()]);

    const run = await harness(ormConfig()).run(['migration', 'log'], {
      cwd: '/tmp',
      isTty: { stdout: true },
    });
    const blocks = run.presented?.presentation.human ?? [];

    expect(blocks[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [{ label: 'database', value: 'postgres://****:****@localhost:5432/appdb' }],
    });
    expect(blocks[1]).toEqual({
      kind: 'table',
      columns: ['Applied at', 'Migration', 'Change', 'Ops'],
      rows: [
        [
          expect.any(String),
          [{ text: '20260601T0800_initial', tone: 'emphasis' }],
          [
            { text: '∅', tone: 'structure' },
            { text: ' ' },
            { text: '→', tone: 'structure' },
            { text: ' ' },
            { text: 'dest-ha', tone: 'identifier' },
          ],
          '3 ops',
        ],
      ],
    });
    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(run.stdout).toBe('');
  });

  it('lines the table up under its headings', async () => {
    mocks.readLedger.mockResolvedValue([ledgerEntry()]);

    const run = await harness(ormConfig()).run(['migration', 'log'], {
      cwd: '/tmp',
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr).split('\n');
    const heading = rendered.find((line) => line.includes('Migration'));
    const row = rendered.find((line) => line.includes('20260601T0800_initial'));

    expect(heading).toBeDefined();
    expect(row).toBeDefined();
    expect(heading?.indexOf('Migration')).toBe(row?.indexOf('20260601T0800_initial'));
  });

  it('reports an empty ledger with the empty-state line', async () => {
    const run = await harness(ormConfig()).run(['migration', 'log'], {
      cwd: '/tmp',
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.presentation.human.at(-1)).toEqual({
      kind: 'summary',
      status: 'info',
      text: 'No migrations have been applied to this database.',
    });
  });

  it('takes the connection from --db over the config', async () => {
    await harness(ormConfig()).run(['migration', 'log', '--db', 'postgres://other/db', '--json'], {
      cwd: '/tmp',
    });

    expect(mocks.connect).toHaveBeenCalledWith('postgres://other/db');
  });

  it('errors when no connection is configured', async () => {
    const run = await harness(ormConfig({ db: undefined })).run(['migration', 'log', '--json'], {
      cwd: '/tmp',
    });
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' },
    });
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });

  it('raises the migration namespace code when the target has no runner', async () => {
    const config = ormConfig();
    const run = await harness({
      ...config,
      target: { ...DESCRIPTOR, kind: 'target', id: 'postgres' },
    }).run(['migration', 'log', '--json'], { cwd: '/tmp' });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.TARGET_UNSUPPORTED' } },
    });
  });

  it('closes the connection even when the ledger read fails', async () => {
    mocks.readLedger.mockRejectedValue(new Error('connection reset'));

    const run = await harness(ormConfig()).run(['migration', 'log', '--json'], {
      cwd: '/tmp',
    });

    expect(run.exitCode).toBe(2);
    expect(mocks.close).toHaveBeenCalled();
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.UNEXPECTED' } },
    });
  });

  describe('a close that fails on the way out', () => {
    it('reports the connection failure rather than the failure to hang up', async () => {
      mocks.connect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
      mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

      const run = await harness(ormConfig()).run(['migration', 'log', '--json'], {
        cwd: '/tmp',
      });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).toContain('ECONNREFUSED 127.0.0.1:5432');
      expect(settled).not.toContain('close on an unconnected client');
    });

    it('does not turn a successful read into a failure', async () => {
      mocks.readLedger.mockResolvedValue([ledgerEntry()]);
      mocks.close.mockRejectedValue(new Error('close failed'));

      const run = await harness(ormConfig()).run(['migration', 'log', '--json'], {
        cwd: '/tmp',
      });

      expect(run.exitCode).toBe(0);
      expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: true } });
    });
  });
});
