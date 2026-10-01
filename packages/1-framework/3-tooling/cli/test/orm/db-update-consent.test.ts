import { rmSync, writeFileSync } from 'node:fs';
import { notOk, ok } from '@internal/utils/result';
import type { EngineEvent, StreamEvent } from '@prisma/cli-engine';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const mocks = {
  connect: vi.fn(),
  dbUpdate: vi.fn(),
  renderContractDts: vi.fn(),
  close: vi.fn(),
};

/** The command tree mounted over a control-client double instead of the real client. */
const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      dbUpdate: mocks.dbUpdate,
      renderContractDts: mocks.renderContractDts,
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
const TOKEN = 'appdb';
const PLAN_HASH = 'c'.repeat(64);
const FRESH_PLAN_HASH = 'e'.repeat(64);
const QUESTION = 'Apply 1 destructive operation(s) to appdb?';

let projectDir: string;
const projectDirs: string[] = [];

beforeEach(() => {
  projectDir = createTestProjectDir('orm-db-update-consent');
  projectDirs.push(projectDir);
  writeProjectManifest(projectDir);
  writeFileSync(
    join(projectDir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: MARKER_HASH } }),
  );
  writeFileSync(join(projectDir, 'contract.d.ts'), 'export type Contract = never;\n');
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.dbUpdate.mockReset().mockImplementation(refuseUntilConsented());
  mocks.renderContractDts
    .mockReset()
    .mockResolvedValue(ok({ contractDts: 'export type Contract = never;\n' }));
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
      operations: [{ id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' }],
    },
    execution: { operationsPlanned: 1, operationsExecuted: 1 },
    marker: { storageHash: MARKER_HASH },
    perSpace: [
      {
        spaceId: 'app',
        kind: 'app',
        operations: [{ id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' }],
        marker: { storageHash: MARKER_HASH },
      },
    ],
    summary: 'Database updated',
  };
}

function destructiveRefusal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'DESTRUCTIVE_CHANGES',
    summary: 'Planned 1 destructive operation(s) that require confirmation',
    why: 'Destructive operations require confirmation',
    conflicts: undefined,
    meta: undefined,
    destructiveChanges: {
      destructiveOperations: [{ id: 'op-2', label: 'drop relation legacy' }],
      databaseName: TOKEN,
      planHash: PLAN_HASH,
    },
    ...overrides,
  };
}

/** The refusal an apply carrying a stale consent comes back with. */
function planMismatchFailure(): Record<string, unknown> {
  return {
    code: 'CONSENT_PLAN_MISMATCH',
    summary: 'The plan changed between consent and apply',
    why: 'The freshly computed plan is not the plan that was consented to',
    conflicts: undefined,
    meta: undefined,
    consentPlanMismatch: { consentedPlanHash: PLAN_HASH, planHash: FRESH_PLAN_HASH },
  };
}

function warnTexts(events: readonly EngineEvent[]): readonly string[] {
  return events.flatMap((event) =>
    event.kind === 'message' && event.severity === 'warn' ? [event.text] : [],
  );
}

/**
 * The control API's own shape: an apply without consent refuses when the plan
 * carries destructive operations, and the call consenting to that exact plan
 * (by its hash) applies.
 */
function refuseUntilConsented() {
  return (options: { readonly consent?: { readonly planHash: string } }) =>
    Promise.resolve(
      options.consent?.planHash === PLAN_HASH ? ok(applySuccess()) : notOk(destructiveRefusal()),
    );
}

function harness(config: Record<string, unknown> = ormConfig()) {
  return createOrmTestCli({ commands, groups, orm: config });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

function applyCalls(): readonly { readonly consent?: { readonly planHash: string } }[] {
  return mocks.dbUpdate.mock.calls.map((call) => call[0]);
}

describe('db update consent', () => {
  describe('interactively', () => {
    it('applies the destructive plan once the database name is typed', async () => {
      const run = await harness().run(['db', 'update', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: [TOKEN],
      });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({ ok: true, result: { mode: 'apply' } });
      expect(mocks.connect).toHaveBeenCalledTimes(1);
      expect(applyCalls().map((call) => call.consent)).toEqual([
        undefined,
        { planHash: PLAN_HASH },
      ]);
    });

    /**
     * Typed on stdin rather than scripted through `answers`: a scripted answer
     * is returned without the prompt ever being rendered, so the question only
     * reaches stderr when the run reads it from the stream.
     */
    it('names the database and every destructive operation in the question', async () => {
      const run = await harness().run(['db', 'update'], {
        cwd: projectDir,
        isTty: { stdin: true, stdout: true, stderr: true },
        stdin: `${TOKEN}\n`,
      });

      const rendered = stripAnsi(run.stderr);
      expect(rendered).toContain(QUESTION);
      expect(rendered).toContain('drop relation legacy');
    });

    it('shows the planner`s warnings before it asks', async () => {
      const warning = 'Column user.legacy is dropped without a backfill';
      mocks.dbUpdate
        .mockReset()
        .mockImplementation((options: { consent?: { planHash: string } }) =>
          Promise.resolve(
            options.consent?.planHash === PLAN_HASH
              ? ok(applySuccess())
              : notOk(destructiveRefusal({ warnings: [{ summary: warning }] })),
          ),
        );

      const run = await harness().run(['db', 'update'], {
        cwd: projectDir,
        isTty: { stdin: true, stdout: true, stderr: true },
        stdin: `${TOKEN}\n`,
      });

      const rendered = stripAnsi(run.stderr);
      expect(warnTexts(run.events)).toContain(warning);
      expect(rendered).toContain(QUESTION);
      expect(rendered.indexOf(warning)).toBeLessThan(rendered.indexOf(QUESTION));
    });

    it('applies nothing when the answer is not the database name', async () => {
      const run = await harness().run(['db', 'update', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: ['no'],
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.PROMPT_INVALID' },
      });
      expect(applyCalls()).toHaveLength(1);
    });

    it('exits 3 when the prompt is cancelled', async () => {
      const run = await harness().run(['db', 'update', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        stdin: '',
      });

      expect(run.exitCode).toBe(3);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.PROMPT_CANCELLED' },
      });
      expect(applyCalls()).toHaveLength(1);
    });
  });

  describe('non-interactively', () => {
    it('refuses without --confirm, naming the token to pass', async () => {
      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.CONSENT_REQUIRED', meta: { consentToken: TOKEN } },
      });
      expect(applyCalls()).toHaveLength(1);
    });

    it('applies when --confirm carries the database name', async () => {
      const run = await harness().run(['db', 'update', '--confirm', TOKEN, '--json'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(envelopeOf(run.json)).toMatchObject({ ok: true, result: { mode: 'apply' } });
      expect(applyCalls().map((call) => call.consent)).toEqual([
        undefined,
        { planHash: PLAN_HASH },
      ]);
    });

    it('refuses when --confirm carries another name', async () => {
      const run = await harness().run(['db', 'update', '--confirm', 'otherdb', '--json'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.CONSENT_REQUIRED' },
      });
      expect(applyCalls()).toHaveLength(1);
    });
  });

  describe('--yes', () => {
    it('does not accept data loss on its own', async () => {
      const run = await harness().run(['db', 'update', '--yes', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.CONSENT_REQUIRED' },
      });
      expect(applyCalls()).toHaveLength(1);
    });

    it('does not stop --confirm from granting', async () => {
      const run = await harness().run(['db', 'update', '--yes', '--confirm', TOKEN, '--json'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(applyCalls().map((call) => call.consent)).toEqual([
        undefined,
        { planHash: PLAN_HASH },
      ]);
    });
  });

  describe('the consent token', () => {
    it('asks with the database name the refusal carries', async () => {
      mocks.dbUpdate.mockReset().mockResolvedValue(
        notOk(
          destructiveRefusal({
            destructiveChanges: {
              destructiveOperations: [{ id: 'op-2', label: 'drop relation legacy' }],
              databaseName: 'otherdb',
              planHash: PLAN_HASH,
            },
          }),
        ),
      );

      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { meta: { consentToken: 'otherdb' } },
      });
    });
  });

  describe('when the question would be unanswerable', () => {
    it('refuses rather than ask for a blank token', async () => {
      mocks.dbUpdate.mockReset().mockResolvedValue(
        notOk(
          destructiveRefusal({
            destructiveChanges: {
              destructiveOperations: [{ id: 'op-2', label: 'drop relation legacy' }],
              databaseName: undefined,
              planHash: PLAN_HASH,
            },
          }),
        ),
      );

      const run = await harness().run(['db', 'update', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: [TOKEN],
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.CONSENT_TOKEN_UNRESOLVED' },
      });
      expect(applyCalls()).toHaveLength(1);
    });

    it('refuses rather than ask about operations the refusal did not name', async () => {
      mocks.dbUpdate.mockReset().mockResolvedValue(
        notOk(
          destructiveRefusal({
            destructiveChanges: {
              destructiveOperations: [],
              databaseName: TOKEN,
              planHash: PLAN_HASH,
            },
          }),
        ),
      );

      const run = await harness().run(['db', 'update', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: [TOKEN],
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CLI.CONSENT_OPERATIONS_MISSING' },
      });
      expect(applyCalls()).toHaveLength(1);
    });
  });

  describe('when the applied plan is not the plan consented to', () => {
    it('surfaces the control API`s typed mismatch refusal as an error', async () => {
      mocks.dbUpdate
        .mockReset()
        .mockImplementation((options: { consent?: { planHash: string } }) =>
          Promise.resolve(
            options.consent === undefined
              ? notOk(destructiveRefusal())
              : notOk(planMismatchFailure()),
          ),
        );

      const run = await harness().run(['db', 'update', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: [TOKEN],
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'MIGRATION.CONSENT_PLAN_MISMATCH' },
      });
      expect(applyCalls().map((call) => call.consent)).toEqual([
        undefined,
        { planHash: PLAN_HASH },
      ]);
    });

    it('carries the consented plan through the re-run untouched', async () => {
      const run = await harness().run(['db', 'update', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: [TOKEN],
      });

      expect(run.exitCode).toBe(0);
      expect(warnTexts(run.events)).toEqual([]);
    });
  });

  describe('--dry-run', () => {
    it('never asks, even when the plan call comes back destructive', async () => {
      const run = await harness().run(['db', 'update', '--dry-run', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: [TOKEN],
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'MIGRATION.DESTRUCTIVE_CHANGES' },
      });
      expect(mocks.dbUpdate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'plan' }));
      expect(applyCalls()).toHaveLength(1);
    });
  });

  describe('when nothing destructive is planned', () => {
    beforeEach(() => {
      mocks.dbUpdate.mockReset().mockResolvedValue(ok(applySuccess()));
    });

    it('applies without asking, even non-interactively', async () => {
      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(applyCalls()).toHaveLength(1);
      expect(applyCalls()[0]?.consent).toBeUndefined();
      expect(run.stderr).not.toContain('confirm');
    });

    it('plans without asking under --dry-run', async () => {
      const run = await harness().run(['db', 'update', '--dry-run', '--json'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(mocks.dbUpdate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'plan' }));
      expect(applyCalls()).toHaveLength(1);
    });
  });
});
