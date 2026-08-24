import { rmSync, writeFileSync } from 'node:fs';
import { notOk, ok } from '@internal/utils/result';
import type { EngineEvent, StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const mocks = {
  connect: vi.fn(),
  dbUpdate: vi.fn(),
  close: vi.fn(),
};

/** The command tree mounted over a control-client double instead of the real client. */
const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      dbUpdate: mocks.dbUpdate,
      close: mocks.close,
    }) as unknown as ControlClient,
);
const groups = BIN_GROUPS;

afterAll(() => {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

const DEST_HASH = 'd'.repeat(64);
const MARKER_HASH = 'a'.repeat(64);
const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';

let projectDir: string;
const projectDirs: string[] = [];

beforeEach(() => {
  projectDir = createTestProjectDir('orm-db-update');
  projectDirs.push(projectDir);
  writeFileSync(
    join(projectDir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: MARKER_HASH } }),
  );
  writeFileSync(join(projectDir, 'contract.d.ts'), 'export type Contract = never;\n');
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.dbUpdate.mockReset().mockResolvedValue(ok(applySuccess()));
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
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    db: { connection: CONNECTION },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: join(projectDir, 'contract.json'),
    },
    ...overrides,
  };
}

function applySuccess(): Record<string, unknown> {
  return {
    mode: 'apply',
    destination: { storageHash: DEST_HASH },
    plan: {
      operations: [
        { id: 'op-1', label: 'add column user.nickname', operationClass: 'additive' },
        { id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' },
      ],
    },
    execution: { operationsPlanned: 2, operationsExecuted: 2 },
    marker: { storageHash: MARKER_HASH },
    perSpace: [
      {
        spaceId: 'app',
        kind: 'app',
        operations: [
          { id: 'op-1', label: 'add column user.nickname', operationClass: 'additive' },
          { id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' },
        ],
        marker: { storageHash: MARKER_HASH },
      },
    ],
    summary: 'Database updated',
  };
}

function planSuccess(): Record<string, unknown> {
  return {
    mode: 'plan',
    destination: { storageHash: DEST_HASH },
    plan: {
      operations: [{ id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' }],
      preview: { statements: [{ language: 'sql', text: 'DROP TABLE "legacy"' }] },
    },
    perSpace: [
      {
        spaceId: 'app',
        kind: 'app',
        operations: [{ id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' }],
      },
    ],
    summary: 'Planned 1 operation',
  };
}

function harness(config: Record<string, unknown> = ormConfig()) {
  return createTestCli({ commands, groups, config: { orm: config } });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

function stepEvents(events: readonly EngineEvent[]): readonly EngineEvent[] {
  return events.filter((event) => event.kind === 'step-started' || event.kind === 'step-finished');
}

describe('db update', () => {
  it('settles as a completed envelope carrying the migration document', async () => {
    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      mode: 'apply',
      plan: { targetId: 'postgres', destination: { storageHash: DEST_HASH } },
      execution: { operationsPlanned: 2, operationsExecuted: 2 },
      marker: { storageHash: MARKER_HASH },
      advancedRef: { name: 'db', hash: MARKER_HASH },
      plannedAdvanceRef: null,
      summary: 'Database updated',
    });
  });

  it('reports the control API`s spans as step events rather than printing them', async () => {
    mocks.dbUpdate.mockImplementation(
      (options: { onProgress?: (event: Record<string, unknown>) => void }) => {
        options.onProgress?.({
          action: 'dbUpdate',
          kind: 'spanStart',
          spanId: 'plan',
          label: 'Planning operations',
        });
        options.onProgress?.({
          action: 'dbUpdate',
          kind: 'spanEnd',
          spanId: 'plan',
          outcome: 'ok',
        });
        return Promise.resolve(ok(applySuccess()));
      },
    );

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(stepEvents(run.events)).toEqual([
      { kind: 'step-started', step: 'Planning operations', id: 'plan' },
      { kind: 'step-finished', step: 'Planning operations', id: 'plan', outcome: 'ok' },
    ]);
  });

  it('heads the run with the contract and the masked database', async () => {
    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [
        { label: 'contract', value: 'contract.json' },
        { label: 'database', value: 'postgres://****:****@localhost:5432/appdb' },
      ],
    });
  });

  it('marks the destructive operation in the tree and warns about data loss', async () => {
    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const blocks = run.presented?.presentation.human ?? [];

    expect(blocks[1]).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'Applied 2 operation(s) across 1 contract space',
    });
    expect(blocks[2]).toEqual({
      kind: 'tree',
      roots: [
        {
          label: [{ text: 'App space', tone: 'identifier' }],
          children: [
            { label: 'add column user.nickname' },
            { label: 'drop relation legacy', status: 'warn' },
            {
              label: [
                { text: 'marker ', tone: 'muted' },
                { text: MARKER_HASH, tone: 'identifier' },
              ],
            },
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

  it('renders the applied tree with the engine`s own connectors', async () => {
    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr);

    expect(rendered).toContain('App space');
    expect(rendered).toMatch(/├─ add column user\.nickname/);
    expect(rendered).toMatch(new RegExp(`└─ .*marker ${MARKER_HASH}`));
    expect(run.stdout).toBe('');
  });

  it('shows the planner`s warnings without failing the run', async () => {
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...applySuccess(),
        warnings: [{ summary: 'Column user.legacy is dropped without a backfill' }],
      }),
    );

    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    const blocks = run.presented?.presentation.human ?? [];

    expect(run.exitCode).toBe(0);
    expect(blocks[2]).toEqual({ kind: 'summary', status: 'warn', text: 'Planner warnings' });
    expect(blocks[3]).toEqual({
      kind: 'list',
      items: ['Column user.legacy is dropped without a backfill'],
    });
  });

  it('names the follow-up as a typed action instead of trailing prose', async () => {
    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Confirm the space is up to date',
        command: '{bin} migration status',
      },
    ]);
  });

  describe('--dry-run', () => {
    beforeEach(() => {
      mocks.dbUpdate.mockResolvedValue(ok(planSuccess()));
    });

    it('plans without applying and says so', async () => {
      const run = await harness().run(['db', 'update', '--dry-run'], {
        cwd: projectDir,
        isTty: { stdout: true },
      });
      const blocks = run.presented?.presentation.human ?? [];

      expect(mocks.dbUpdate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'plan' }));
      expect(blocks[1]).toEqual({
        kind: 'summary',
        status: 'ok',
        text: 'Planned 1 operation(s) across 1 contract space',
      });
      expect(blocks.at(-1)).toEqual({
        kind: 'summary',
        status: 'info',
        tone: 'muted',
        text: 'This is a dry run. No changes were applied.',
      });
    });

    it('offers the apply as the next action', async () => {
      const run = await harness().run(['db', 'update', '--dry-run'], {
        cwd: projectDir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.next).toEqual([
        {
          kind: 'run-command',
          label: 'Apply the planned operations',
          command: '{bin} db update',
        },
      ]);
    });
  });

  it('takes the connection from --db over the config', async () => {
    await harness().run(['db', 'update', '--db', 'postgres://other/db', '--json'], {
      cwd: projectDir,
    });

    expect(mocks.connect).toHaveBeenCalledWith('postgres://other/db');
  });

  it('errors when no connection is configured', async () => {
    const run = await harness(ormConfig({ db: undefined })).run(['db', 'update', '--json'], {
      cwd: projectDir,
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' },
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('errors when the emitted contract is missing', async () => {
    const run = await harness(
      ormConfig({
        contract: {
          source: { format: 'typescript', inputs: [], load: async () => ({}) },
          output: join(projectDir, 'absent.json'),
        },
      }),
    ).run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CLI.FILE_NOT_FOUND' },
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('maps a planning failure to its migration code', async () => {
    mocks.dbUpdate.mockResolvedValue(
      notOk({
        code: 'PLANNING_FAILED',
        summary: 'planning failed',
        why: undefined,
        conflicts: [],
        meta: undefined,
      }),
    );

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.PLANNING_FAILED' },
    });
  });

  it('reports the planner`s warnings even when the apply fails', async () => {
    mocks.dbUpdate.mockResolvedValue(
      notOk({
        code: 'RUNNER_FAILED',
        summary: 'runner failed',
        why: undefined,
        conflicts: undefined,
        warnings: [{ kind: 'suppressed', summary: 'control policy suppressed: table "auth.x"' }],
        meta: undefined,
      }),
    );

    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.events).toContainEqual({
      kind: 'message',
      severity: 'warn',
      text: 'control policy suppressed: table "auth.x"',
    });
    expect(stripAnsi(run.stderr)).toContain('control policy suppressed: table "auth.x"');
  });

  it('maps a runner failure to its migration code', async () => {
    mocks.dbUpdate.mockResolvedValue(
      notOk({
        code: 'RUNNER_FAILED',
        summary: 'runner failed',
        why: undefined,
        conflicts: undefined,
        meta: { runnerErrorCode: 'MIGRATION.LEGACY_MARKER_SHAPE' },
      }),
    );

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.RUNNER_FAILED' },
    });
  });

  it('refuses a --to reference no migration package produces', async () => {
    const run = await harness().run(['db', 'update', '--to', 'nope', '--json'], {
      cwd: projectDir,
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({ ok: false, error: { code: expect.any(String) } });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  describe('a connection that fails', () => {
    it('keeps the connection string out of the settled error', async () => {
      mocks.connect.mockRejectedValue(new Error(`connect ECONNREFUSED for ${CONNECTION}`));

      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).not.toContain('secret');
      expect(settled).toContain('ECONNREFUSED');
    });

    it('reports the connection failure rather than the failure to hang up', async () => {
      mocks.connect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
      mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).toContain('ECONNREFUSED 127.0.0.1:5432');
      expect(settled).not.toContain('close on an unconnected client');
    });
  });
});
