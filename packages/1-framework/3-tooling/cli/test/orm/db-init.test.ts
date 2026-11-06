import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  migrationRunnerFailure,
  type SchemaDiffIssue,
  schemaCheckWhy,
} from '@internal/framework-components/control';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { notOk, ok } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';
import type { EngineEvent, StreamEvent } from '@prisma/cli-engine';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runnerFailureFacts } from '../../src/control-api/operations/run-migration';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import {
  dbInitPlanningFailedError,
  dbInitRunnerFailureError,
} from '../../src/utils/db-init-failure';
import { stdoutErrorMeta, stdoutFrames } from '../helpers/json-frames';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const REFUSAL =
  'Column "at": The contract holds this default in a form its data type does not store: pg/timestamptz needs a UTC offset, but "2024-01-01 00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z". Re-emit the contract, then try again.';

function refusedDefault(): Error {
  return structuredError('CONTRACT.DEFAULT_INVALID', REFUSAL, {
    meta: { reason: 'default-not-canonical', column: 'at' },
  });
}

const MISSING_COLUMN: SchemaDiffIssue = {
  path: ['public', 'event', 'id'],
  expected: { id: 'id', nodeKind: 'sql-column', isEqualTo: () => false, children: () => [] },
};

const WARNING = { kind: 'suppressed', summary: 'control policy suppressed: table "auth.x"' };

const mocks = {
  connect: vi.fn(),
  dbInit: vi.fn(),
  renderContractDts: vi.fn(),
  close: vi.fn(),
};
const RENDERED_CONTRACT_DTS = '// rendered\nexport type Contract = { rendered: true };\n';

/** The command tree mounted over a control-client double instead of the real client. */
const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      dbInit: mocks.dbInit,
      renderContractDts: mocks.renderContractDts,
      close: mocks.close,
    }) as unknown as ControlClient,
);

afterAll(() => {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

const DEST_HASH = 'd'.repeat(64);
const MARKER_HASH = 'a'.repeat(64);

let projectDir: string;
const projectDirs: string[] = [];

beforeEach(() => {
  projectDir = createTestProjectDir('orm-db-init');
  projectDirs.push(projectDir);
  writeProjectManifest(projectDir);
  writeFileSync(
    join(projectDir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: MARKER_HASH } }),
  );
  writeFileSync(join(projectDir, 'contract.d.ts'), 'export type Contract = never;\n');
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.dbInit.mockReset().mockResolvedValue(ok(applySuccess()));
  mocks.renderContractDts.mockReset().mockResolvedValue(ok({ contractDts: RENDERED_CONTRACT_DTS }));
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
    db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
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
        { id: 'op-1', label: 'create relation user', operationClass: 'additive' },
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
          { id: 'op-1', label: 'create relation user', operationClass: 'additive' },
          { id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' },
        ],
        marker: { storageHash: MARKER_HASH },
      },
    ],
    summary: 'Database initialized',
  };
}

function planSuccess(): Record<string, unknown> {
  return {
    mode: 'plan',
    destination: { storageHash: DEST_HASH },
    plan: {
      operations: [{ id: 'op-1', label: 'create relation user', operationClass: 'additive' }],
      preview: { statements: [{ language: 'sql', text: 'CREATE TABLE "user" (id int)' }] },
    },
    perSpace: [
      {
        spaceId: 'app',
        kind: 'app',
        operations: [{ id: 'op-1', label: 'create relation user', operationClass: 'additive' }],
      },
    ],
    summary: 'Planned 1 operation',
  };
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups: BIN_GROUPS, orm: config });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

function stepEvents(events: readonly EngineEvent[]): readonly EngineEvent[] {
  return events.filter((event) => event.kind === 'step-started' || event.kind === 'step-finished');
}

describe('db init', () => {
  it('settles as a completed envelope carrying the migration document', async () => {
    const run = await harness(ormConfig()).run(['db', 'init', '--json'], {
      cwd: projectDir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      mode: 'apply',
      plan: { targetId: 'postgres', destination: { storageHash: DEST_HASH } },
      execution: { operationsPlanned: 2, operationsExecuted: 2 },
      marker: { storageHash: MARKER_HASH },
      advancedRef: { name: 'db', hash: MARKER_HASH },
      plannedAdvanceRef: null,
      summary: 'Database initialized',
    });
    expect(run.presented?.data).not.toHaveProperty('appliedStatements');
  });

  it('reports the control API`s spans as step events rather than printing them', async () => {
    mocks.dbInit.mockImplementation(
      (options: { onProgress?: (event: Record<string, unknown>) => void }) => {
        options.onProgress?.({
          action: 'dbInit',
          kind: 'spanStart',
          spanId: 'plan',
          label: 'Planning operations',
        });
        options.onProgress?.({
          action: 'dbInit',
          kind: 'spanEnd',
          spanId: 'plan',
          outcome: 'ok',
        });
        return Promise.resolve(ok(applySuccess()));
      },
    );

    const run = await harness(ormConfig()).run(['db', 'init', '--json'], {
      cwd: projectDir,
    });

    expect(stepEvents(run.events)).toEqual([
      { kind: 'step-started', step: 'Planning operations', id: 'plan' },
      { kind: 'step-finished', step: 'Planning operations', id: 'plan', outcome: 'ok' },
    ]);
  });

  it('lays the applied operations out as a tree the engine draws', async () => {
    const run = await harness(ormConfig()).run(['db', 'init'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const blocks = run.presented?.presentation.human ?? [];

    expect(blocks[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [
        { label: 'contract', value: 'contract.json' },
        { label: 'database', value: 'postgres://****:****@localhost:5432/appdb' },
      ],
    });
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
            { label: 'create relation user' },
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
    const run = await harness(ormConfig()).run(['db', 'init'], {
      cwd: projectDir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr);

    expect(rendered).toContain('App space');
    expect(rendered).toMatch(/├─ create relation user/);
    expect(rendered).toMatch(new RegExp(`└─ .*marker ${MARKER_HASH}`));
    expect(run.stdout).toBe('');
  });

  it('names the follow-up as a typed action instead of trailing prose', async () => {
    const run = await harness(ormConfig()).run(['db', 'init'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Confirm the space is up to date',
        command: 'prisma-test migration status',
      },
    ]);
  });

  describe('--dry-run', () => {
    beforeEach(() => {
      mocks.dbInit.mockResolvedValue(ok(planSuccess()));
    });

    it('plans without applying and says so', async () => {
      const run = await harness(ormConfig()).run(['db', 'init', '--dry-run'], {
        cwd: projectDir,
        isTty: { stdout: true },
      });
      const blocks = run.presented?.presentation.human ?? [];

      expect(mocks.dbInit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'plan' }));
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

    it('shows the destination hash and the statement preview', async () => {
      const run = await harness(ormConfig()).run(['db', 'init', '--dry-run'], {
        cwd: projectDir,
        isTty: { stdout: true },
      });
      const blocks = run.presented?.presentation.human ?? [];

      expect(blocks).toContainEqual({
        kind: 'fields',
        rows: [{ label: 'destination', value: [{ text: DEST_HASH, tone: 'identifier' }] }],
      });
      expect(blocks).toContainEqual({
        kind: 'drawing',
        lines: ['CREATE TABLE "user" (id int);'],
      });
    });

    it('offers the apply as the next action', async () => {
      const run = await harness(ormConfig()).run(['db', 'init', '--dry-run'], {
        cwd: projectDir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.next).toEqual([
        {
          kind: 'run-command',
          label: 'Apply the planned operations',
          command: 'prisma-test db init',
        },
      ]);
    });

    it('marks the run as a dry run in the header', async () => {
      const run = await harness(ormConfig()).run(['db', 'init', '--dry-run'], {
        cwd: projectDir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human[0]).toMatchObject({
        kind: 'fields',
        rail: true,
        rows: expect.arrayContaining([{ label: 'mode', value: 'dry run' }]),
      });
    });
  });

  it('takes the connection from --db over the config', async () => {
    await harness(ormConfig()).run(['db', 'init', '--db', 'postgres://other/db', '--json'], {
      cwd: projectDir,
    });

    expect(mocks.connect).toHaveBeenCalledWith('postgres://other/db');
  });

  it('errors when no connection is configured', async () => {
    const run = await harness(ormConfig({ db: undefined })).run(['db', 'init', '--json'], {
      cwd: projectDir,
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' },
    });
  });

  it('errors when the target has no migration runner', async () => {
    const run = await harness(
      ormConfig({ target: { ...DESCRIPTOR, kind: 'target', id: 'postgres' } }),
    ).run(['db', 'init', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.TARGET_UNSUPPORTED' },
    });
  });

  it('errors when the emitted contract is missing', async () => {
    const run = await harness(
      ormConfig({
        contract: {
          source: { format: 'typescript', inputs: [], load: async () => ({}) },
          output: join(projectDir, 'absent.json'),
        },
      }),
    ).run(['db', 'init', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CLI.FILE_NOT_FOUND' },
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('maps a planning failure to its migration code', async () => {
    mocks.dbInit.mockResolvedValue(notOk(dbInitPlanningFailedError([])));

    const run = await harness(ormConfig()).run(['db', 'init', '--json'], {
      cwd: projectDir,
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.PLANNING_FAILED' },
    });
  });

  it('points a planning failure the additive policy caused at db update', async () => {
    mocks.dbInit.mockResolvedValue(
      notOk(
        dbInitPlanningFailedError([
          {
            kind: 'policy-violation',
            summary: 'destructive operation disallowed: Add validator on events',
            why: "Policy does not allow 'destructive' operations",
            refusedOperationClass: 'destructive',
          },
        ]),
      ),
    );

    const run = await harness(ormConfig()).run(['db', 'init', '--json'], {
      cwd: projectDir,
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.PLANNING_FAILED',
        why: 'destructive operation disallowed: Add validator on events',
        nextActions: [
          {
            kind: 'run-command',
            label:
              'Apply the change with db update, which asks what each operation that would lose data means',
            command: 'prisma-test db update',
          },
        ],
      },
    });
  });

  function refusedClass(refusedOperationClass: 'widening' | 'destructive' | 'data') {
    return {
      kind: 'policy-violation',
      summary: `${refusedOperationClass} operation disallowed`,
      why: `Policy does not allow '${refusedOperationClass}' operations`,
      refusedOperationClass,
    };
  }

  function refusePlanning(...conflicts: ReturnType<typeof refusedClass>[]) {
    mocks.dbInit.mockResolvedValue(notOk(dbInitPlanningFailedError(conflicts)));
  }

  it('points a widening refusal at db update without mentioning confirmation', async () => {
    refusePlanning(refusedClass('widening'));

    const run = await harness(ormConfig()).run(['db', 'init', '--json'], { cwd: projectDir });

    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        nextActions: [
          { label: 'Apply the change with db update', command: 'prisma-test db update' },
        ],
      },
    });
  });

  it('points a data refusal at a planned migration, since db update does not apply data operations', async () => {
    refusePlanning(refusedClass('destructive'), refusedClass('data'));

    const run = await harness(ormConfig()).run(['db', 'init', '--json'], { cwd: projectDir });

    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        nextActions: [
          {
            label: 'Plan a migration, since db update does not apply data operations',
            command: 'prisma-test migration plan',
          },
        ],
      },
    });
  });

  describe('a contract default its data type refuses', () => {
    it('reports the planner`s CONTRACT.DEFAULT_INVALID, not an unexpected error', async () => {
      mocks.dbInit.mockRejectedValue(refusedDefault());

      const run = await harness(ormConfig()).run(['db', 'init', '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: {
          code: 'CONTRACT.DEFAULT_INVALID',
          summary: REFUSAL,
          meta: { reason: 'default-not-canonical', column: 'at' },
        },
      });
    });

    it('shows the refusal and the hint to re-emit', async () => {
      mocks.dbInit.mockRejectedValue(refusedDefault());

      const run = await harness(ormConfig()).run(['db', 'init'], {
        cwd: projectDir,
        isTty: { stdout: true, stderr: true },
      });
      const shown = stripAnsi(run.stderr);

      expect(shown).toContain('CONTRACT.DEFAULT_INVALID');
      expect(shown).toContain(REFUSAL);
      expect(shown).not.toContain('Unexpected error');
    });
  });

  function failWithPlannerWarning() {
    mocks.dbInit.mockImplementation(async (options: Parameters<ControlClient['dbInit']>[0]) => {
      options.onPlannerWarnings?.([WARNING]);
      return notOk(
        dbInitRunnerFailureError(
          migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'runner failed'),
          {},
          { cwd: projectDir, configPath: undefined, dbGiven: false },
        ),
      );
    });
  }

  function succeedWithPlannerWarning() {
    mocks.dbInit.mockImplementation(async (options: Parameters<ControlClient['dbInit']>[0]) => {
      options.onPlannerWarnings?.([WARNING]);
      return ok(applySuccess());
    });
  }

  it('shows the planner`s warnings when the apply succeeds', async () => {
    succeedWithPlannerWarning();

    const run = await harness(ormConfig()).run(['db', 'init'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const blocks = run.presented?.presentation.human ?? [];

    expect(run.exitCode).toBe(0);
    expect(blocks).toContainEqual({ kind: 'summary', status: 'warn', text: 'Planner warnings' });
    expect(blocks).toContainEqual({ kind: 'list', items: [WARNING.summary] });
  });

  it('lists the planner`s warnings in the --json result of a successful apply', async () => {
    succeedWithPlannerWarning();

    const run = await harness(ormConfig()).run(['db', 'init', '--json'], { cwd: projectDir });
    const frames = stdoutFrames(run.stdout);

    expect({
      exitCode: run.exitCode,
      messages: frames.filter((frame) => frame['kind'] === 'message'),
      warnings: (frames.at(-1) as { envelope: { result: { warnings: unknown } } }).envelope.result
        .warnings,
    }).toEqual({ exitCode: 0, messages: [], warnings: [WARNING] });
  });

  it('shows the planner`s warnings when the apply fails', async () => {
    failWithPlannerWarning();

    const run = await harness(ormConfig()).run(['db', 'init'], {
      cwd: projectDir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.events).toContainEqual({ kind: 'message', severity: 'warn', text: WARNING.summary });
    expect(stripAnsi(run.stderr)).toContain(WARNING.summary);
  });

  it('writes the planner`s warnings of a failed apply as warn frames before the --json error', async () => {
    failWithPlannerWarning();

    const run = await harness(ormConfig()).run(['db', 'init', '--json'], { cwd: projectDir });
    const frames = stdoutFrames(run.stdout);

    expect({
      exitCode: run.exitCode,
      kinds: frames.map((frame) => frame['kind']),
      first: frames[0],
    }).toEqual({
      exitCode: 2,
      kinds: ['message', 'result'],
      first: expect.objectContaining({ kind: 'message', severity: 'warn', text: WARNING.summary }),
    });
  });

  it('reports a runner failure with the runner code and meta, and the advice', async () => {
    const runnerFailure = migrationRunnerFailure(
      'MIGRATION.SCHEMA_VERIFY_FAILED',
      'Database schema does not satisfy contract',
      {
        why: schemaCheckWhy([MISSING_COLUMN]),
        meta: { schemaIssues: [MISSING_COLUMN], failingSpace: 'app' },
      },
    );
    mocks.dbInit.mockResolvedValue(
      notOk(
        dbInitRunnerFailureError(runnerFailure, runnerFailureFacts(runnerFailure, []), {
          cwd: projectDir,
          configPath: undefined,
          dbGiven: false,
        }),
      ),
    );

    const run = await harness(ormConfig()).run(['db', 'init', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.SCHEMA_VERIFY_FAILED',
        summary: 'Database schema does not satisfy contract',
        why: 'The schema check after apply found: missing: public/event/id.',
        nextActions: [
          {
            kind: 'edit-file',
            label:
              'Change the contract source to resolve the issues listed, re-run `prisma-test contract emit`, then re-run `prisma-test db init`',
          },
        ],
        meta: { schemaIssues: [{ path: ['public', 'event', 'id'] }], failingSpace: 'app' },
      },
    });
    expect(stdoutErrorMeta(run.stdout)).toEqual(JSON.parse(JSON.stringify(runnerFailure.meta)));
    expect(mocks.dbInit).toHaveBeenCalledWith(
      expect.objectContaining({
        invocation: { cwd: projectDir, configPath: undefined, dbGiven: false },
      }),
    );
  });

  describe('a close that fails on the way out', () => {
    it('reports the connection failure rather than the failure to hang up', async () => {
      mocks.connect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
      mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

      const run = await harness(ormConfig()).run(['db', 'init', '--json'], {
        cwd: projectDir,
      });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).toContain('ECONNREFUSED 127.0.0.1:5432');
      expect(settled).not.toContain('close on an unconnected client');
    });

    it('does not turn a successful apply into a failure', async () => {
      mocks.close.mockRejectedValue(new Error('close failed'));

      const run = await harness(ormConfig()).run(['db', 'init', '--json'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({ ok: true });
    });
  });

  describe('ref advancement', () => {
    it('renders the snapshot types from the contract before touching the database', async () => {
      const run = await harness(ormConfig()).run(['db', 'init', '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(mocks.renderContractDts).toHaveBeenCalledWith({
        contract: { storage: { storageHash: MARKER_HASH } },
        resolveImportSpecifier: expect.any(Function),
      });
      expect(mocks.renderContractDts.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.connect.mock.invocationCallOrder[0]!,
      );
      const storeDir = contractSnapshotDir(join(projectDir, 'migrations'), MARKER_HASH);
      expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(RENDERED_CONTRACT_DTS);
    });

    it('refuses before connecting when the contract types cannot be rendered', async () => {
      mocks.renderContractDts.mockResolvedValue(
        notOk({
          code: 'RENDER_FAILED',
          summary: 'Failed to render contract types',
          why: 'relation author must declare nullability',
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'init', '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CONTRACT.TYPES_RENDER_FAILED' },
      });
      expect(JSON.stringify(run.json.at(-1))).toContain('relation author must declare nullability');
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.dbInit).not.toHaveBeenCalled();
      expect(existsSync(join(projectDir, 'migrations'))).toBe(false);
    });

    it('does not render when --db leaves the ref alone', async () => {
      const run = await harness(ormConfig()).run(
        [...['db', 'init', '--json'], '--db', 'postgres://user:secret@localhost:5432/other'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(0);
      expect(mocks.renderContractDts).not.toHaveBeenCalled();
      expect(run.presented?.data).toMatchObject({ advancedRef: null });
    });
  });
});
