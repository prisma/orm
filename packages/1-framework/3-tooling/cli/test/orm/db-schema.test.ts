import type { StreamEvent } from '@prisma/cli-engine';
import stripAnsi from 'strip-ansi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';

const mocks = {
  introspect: vi.fn(),
  toSchemaView: vi.fn(),
  inferPslContract: vi.fn(),
  getPslBlockDescriptors: vi.fn(),
  close: vi.fn(),
};

/** The command tree mounted over a control-client double instead of the real client. */
const commands = createBinCommands(
  () =>
    ({
      introspect: mocks.introspect,
      toSchemaView: mocks.toSchemaView,
      inferPslContract: mocks.inferPslContract,
      getPslBlockDescriptors: mocks.getPslBlockDescriptors,
      close: mocks.close,
    }) as unknown as ControlClient,
);

const SCHEMA_IR = { relations: { user: { fields: ['id', 'email'] } } };

const SCHEMA_VIEW = {
  root: {
    kind: 'root',
    id: 'sql-schema',
    label: 'sql schema (1 entity)',
    children: [
      {
        kind: 'entity',
        id: 'entity-user',
        label: 'table user',
        children: [
          {
            kind: 'collection',
            id: 'fields-user',
            label: 'columns',
            children: [
              { kind: 'field', id: 'user-id', label: 'id: int4 (not null)' },
              { kind: 'field', id: 'user-email', label: 'email: text (nullable)' },
            ],
          },
          { kind: 'index', id: 'user-pk', label: 'primary key: id' },
        ],
      },
    ],
  },
};

beforeEach(() => {
  mocks.introspect.mockReset().mockResolvedValue(SCHEMA_IR);
  mocks.toSchemaView.mockReset().mockReturnValue(SCHEMA_VIEW);
  mocks.inferPslContract.mockReset().mockReturnValue(undefined);
  mocks.getPslBlockDescriptors.mockReset().mockReturnValue({});
  mocks.close.mockReset().mockResolvedValue(undefined);
});

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

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

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups: BIN_GROUPS, orm: config });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

describe('db schema', () => {
  it('settles as a completed envelope carrying the introspection document', async () => {
    const run = await harness(ormConfig()).run(['db', 'schema', '--json'], { cwd: '/tmp' });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      ok: true,
      summary: 'Schema read successfully',
      target: { familyId: 'sql', id: 'postgres' },
      schema: SCHEMA_IR,
      meta: { dbUrl: 'postgres://****:****@localhost:5432/appdb' },
      timings: { total: expect.any(Number) },
    });
  });

  it('never asks the family to infer a contract it would throw away', async () => {
    await harness(ormConfig()).run(['db', 'schema', '--json'], { cwd: '/tmp' });

    expect(mocks.introspect).toHaveBeenCalledTimes(1);
    expect(mocks.inferPslContract).not.toHaveBeenCalled();
  });

  it('ships the schema view as a tree whose spans carry tone', async () => {
    const run = await harness(ormConfig()).run(['db', 'schema'], {
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
      kind: 'tree',
      roots: [
        {
          label: [{ text: 'sql schema (1 entity)', tone: 'emphasis' }],
          children: [
            {
              label: [
                { text: 'table', tone: 'muted' },
                { text: ' ' },
                { text: 'user', tone: 'identifier' },
              ],
              children: [
                {
                  label: [{ text: 'columns', tone: 'muted' }],
                  children: [
                    {
                      label: [
                        { text: 'id', tone: 'identifier' },
                        { text: ': int4 ' },
                        { text: '(not null)', tone: 'muted' },
                      ],
                    },
                    {
                      label: [
                        { text: 'email', tone: 'identifier' },
                        { text: ': text ' },
                        { text: '(nullable)', tone: 'muted' },
                      ],
                    },
                  ],
                },
                {
                  label: [
                    { text: 'primary key', tone: 'muted' },
                    { text: ': ' },
                    { text: 'id', tone: 'identifier' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('lets the engine draw the connectors under the root', async () => {
    const run = await harness(ormConfig()).run(['db', 'schema'], {
      cwd: '/tmp',
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr);

    expect(rendered).toContain('sql schema (1 entity)');
    expect(rendered).toMatch(/[└├]─ table user/);
    expect(rendered).toMatch(/id: int4 \(not null\)/);
  });

  it('writes nothing to stdout in human mode', async () => {
    const run = await harness(ormConfig()).run(['db', 'schema'], {
      cwd: '/tmp',
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(run.stdout).toBe('');
  });

  it('falls back to the summary when the family produces no schema view', async () => {
    mocks.toSchemaView.mockReturnValue(undefined);

    const run = await harness(ormConfig()).run(['db', 'schema'], {
      cwd: '/tmp',
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.presentation.human.at(-1)).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'Schema read successfully',
    });
  });

  it('takes the connection from --db over the config', async () => {
    await harness(ormConfig()).run(['db', 'schema', '--db', 'postgres://other/db', '--json'], {
      cwd: '/tmp',
    });

    expect(mocks.introspect).toHaveBeenCalledWith(
      expect.objectContaining({ connection: 'postgres://other/db' }),
    );
  });

  it('errors when no connection is configured', async () => {
    const run = await harness(ormConfig({ db: undefined })).run(['db', 'schema', '--json'], {
      cwd: '/tmp',
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' },
    });
  });

  it('errors when the config declares no driver', async () => {
    const run = await harness(ormConfig({ driver: undefined })).run(['db', 'schema', '--json'], {
      cwd: '/tmp',
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CONFIG.DRIVER_REQUIRED' },
    });
  });

  it('keeps the connection string out of a failed introspection', async () => {
    mocks.introspect.mockRejectedValue(
      new Error('connect failed for postgres://user:secret@localhost:5432/appdb'),
    );

    const run = await harness(ormConfig()).run(['db', 'schema', '--json'], { cwd: '/tmp' });
    const settled = JSON.stringify(run.json.at(-1));

    expect(run.exitCode).toBe(2);
    expect(mocks.close).toHaveBeenCalled();
    expect(settled).toContain('CLI.UNEXPECTED');
    expect(settled).not.toContain('secret');
  });

  describe('a close that fails on the way out', () => {
    it('reports the introspection failure rather than the failure to hang up', async () => {
      mocks.introspect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
      mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

      const run = await harness(ormConfig()).run(['db', 'schema', '--json'], {
        cwd: '/tmp',
      });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).toContain('ECONNREFUSED 127.0.0.1:5432');
      expect(settled).not.toContain('close on an unconnected client');
    });

    it('does not turn a successful read into a failure', async () => {
      mocks.close.mockRejectedValue(new Error('close failed'));

      const run = await harness(ormConfig()).run(['db', 'schema', '--json'], {
        cwd: '/tmp',
      });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({ ok: true });
    });
  });
});
