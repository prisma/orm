import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { CliStructuredError } from '@internal/errors/control';
import type { ErroredEnvelope, MountedTree, StreamEvent } from '@prisma/cli-engine';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createContractInferCommand } from '../../src/orm/contract/infer';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const PSL = 'model User {\n  id Int @id\n}\n';

/**
 * The command is mounted from the factory with a control-client double and a
 * printer double injected, so no module mocking is involved and the doubles
 * are scoped to this file.
 */
const mocks = {
  introspect: vi.fn(),
  inferPslContract: vi.fn(),
  getPslBlockDescriptors: vi.fn(),
  close: vi.fn(),
  printPsl: vi.fn(),
};

const commands: MountedTree = {
  'contract infer': createContractInferCommand({
    createControlClient: () => ({
      introspect: mocks.introspect,
      inferPslContract: mocks.inferPslContract,
      getPslBlockDescriptors: mocks.getPslBlockDescriptors,
      close: mocks.close,
    }),
    printPsl: mocks.printPsl,
  }),
};
const groups = BIN_GROUPS;

const dirs: string[] = [];

async function projectDir(): Promise<string> {
  const dir = createTestProjectDir('orm-infer');
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  mocks.introspect.mockReset().mockResolvedValue({ tables: [] });
  mocks.inferPslContract.mockReset().mockReturnValue({ kind: 'psl-document' });
  mocks.getPslBlockDescriptors.mockReset().mockReturnValue({});
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.printPsl.mockReset().mockReturnValue(PSL);
});

const DESCRIPTOR = {
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
  create: () => ({}),
};

const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';

function ormConfig(dir: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres' },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    db: { connection: CONNECTION },
    contract: {
      source: { format: 'psl', inputs: [], load: () => ({}) },
      output: join(dir, 'generated', 'contract.json'),
    },
    ...overrides,
  };
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups, orm: config });
}

function erroredEnvelope(run: { readonly json: readonly StreamEvent[] }): ErroredEnvelope {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    throw new Error('the run did not settle as an errored envelope');
  }
  return terminal.envelope;
}

describe('contract infer', () => {
  it('settles as a completed envelope carrying the infer document', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(['contract', 'infer', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: true, exitCode: 0 } });
    expect(run.presented?.data).toEqual({
      ok: true,
      summary: 'Contract inferred successfully',
      target: { familyId: 'sql', id: 'postgres' },
      psl: { path: 'generated/contract.prisma' },
      meta: { dbUrl: 'postgres://****:****@localhost:5432/appdb' },
      timings: { total: expect.any(Number) },
    });
  });

  it('writes the printed PSL beside the emitted contract', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(['contract', 'infer', '--json'], { cwd: dir });

    expect(await readFile(join(dir, 'generated', 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('publishes through a staged rename, leaving no temporary file behind', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(['contract', 'infer', '--json'], { cwd: dir });

    expect(await readdir(join(dir, 'generated'))).toEqual(['contract.prisma']);
  });

  it('resolves a relative --output against the invocation directory', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(
      ['contract', 'infer', '--output', 'schema/live.prisma', '--json'],
      { cwd: dir },
    );

    expect(await readFile(join(dir, 'schema', 'live.prisma'), 'utf-8')).toBe(PSL);
    expect(run.presented?.data).toMatchObject({ psl: { path: 'schema/live.prisma' } });
  });

  it('colocates contract.prisma with the default emit output when none is configured', async () => {
    const dir = await projectDir();
    const config = ormConfig(dir, {
      contract: { source: { format: 'psl', inputs: [], load: () => ({}) } },
    });

    await harness(config).run(['contract', 'infer', '--json'], { cwd: dir });

    expect(await readFile(join(dir, 'src', 'prisma', 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('overwrites an existing contract with a warning and no prompt', async () => {
    const dir = await projectDir();
    const run1 = await harness(ormConfig(dir)).run(
      ['contract', 'infer', '--output', 'contract.prisma', '--json'],
      { cwd: dir },
    );
    await writeFile(join(dir, 'contract.prisma'), 'model Stale {}\n', 'utf-8');

    const run2 = await harness(ormConfig(dir)).run(
      ['contract', 'infer', '--output', 'contract.prisma', '--json'],
      { cwd: dir },
    );

    expect(run1.events).not.toContainEqual(expect.objectContaining({ severity: 'warn' }));
    expect(run2.exitCode).toBe(0);
    expect(run2.events).toContainEqual({
      kind: 'message',
      severity: 'warn',
      text: 'Overwriting existing file: contract.prisma',
    });
    expect(await readFile(join(dir, 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  it('takes the connection from --db over the config', async () => {
    const dir = await projectDir();

    await harness(ormConfig(dir)).run(
      ['contract', 'infer', '--db', 'postgres://other/db', '--json'],
      {
        cwd: dir,
      },
    );

    expect(mocks.introspect).toHaveBeenCalledWith(
      expect.objectContaining({ connection: 'postgres://other/db' }),
    );
  });

  it('ships the database header and the written path as blocks', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir)).run(['contract', 'infer'], {
      cwd: dir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'fields',
        rail: true,
        rows: [{ label: 'database', value: 'postgres://****:****@localhost:5432/appdb' }],
      },
      {
        kind: 'summary',
        status: 'ok',
        text: [
          { text: 'Contract written to ' },
          { text: 'generated/contract.prisma', tone: 'identifier' },
        ],
      },
    ]);
    expect(run.presented?.presentation.stdout).toEqual([]);
    expect(stripAnsi(run.stderr)).toContain('Contract written to generated/contract.prisma');
    expect(run.stdout).toBe('');
  });

  it('errors when no connection is configured', async () => {
    const dir = await projectDir();
    const run = await harness(ormConfig(dir, { db: undefined })).run(
      ['contract', 'infer', '--json'],
      { cwd: dir },
    );
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({ ok: false, error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' } });
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });

  it('errors when the config declares no driver', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig(dir, { driver: undefined })).run(
      ['contract', 'infer', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONFIG.DRIVER_REQUIRED' } },
    });
  });

  it('errors when the family cannot infer a PSL contract', async () => {
    const dir = await projectDir();
    mocks.inferPslContract.mockReturnValue(undefined);

    const run = await harness(ormConfig(dir)).run(['contract', 'infer', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONTRACT.INFER_UNSUPPORTED' } },
    });
    expect(mocks.close).toHaveBeenCalled();
  });

  it('closes the connection and hides the connection string when introspection fails', async () => {
    const dir = await projectDir();
    mocks.introspect.mockRejectedValue(new Error(`connect ECONNREFUSED for ${CONNECTION}`));

    const run = await harness(ormConfig(dir)).run(['contract', 'infer', '--json'], {
      cwd: dir,
    });
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(run.exitCode).toBe(2);
    expect(mocks.close).toHaveBeenCalled();
    expect(envelope).toMatchObject({ ok: false, error: { code: 'CLI.UNEXPECTED' } });
    expect(JSON.stringify(envelope)).not.toContain('secret');
  });

  it('writes the schema even when hanging up fails', async () => {
    const dir = await projectDir();
    mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

    const run = await harness(ormConfig(dir)).run(['contract', 'infer', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(await readFile(join(dir, 'generated', 'contract.prisma'), 'utf-8')).toBe(PSL);
  });

  /**
   * The handler's own catch wraps the introspection, so a throw from the write
   * that follows it escapes to `defineOrmCommand`. Without that boundary the
   * engine settles the throw itself: it accepts prisma/prisma's
   * `CliStructuredError` on the name alone and emits the non-protocol `fix`
   * field, and it settles anything else as an engine bug at exit 1.
   */
  describe('the ORM error boundary', () => {
    it('turns a prisma/prisma structured error into a protocol envelope', async () => {
      const dir = await projectDir();
      mocks.printPsl.mockImplementation(() => {
        throw new CliStructuredError('PSL.PRINT_FAILED', 'The document could not be printed', {
          fix: 'Re-run after fixing the schema',
        });
      });

      const run = await harness(ormConfig(dir)).run(['contract', 'infer', '--json'], {
        cwd: dir,
      });
      const envelope = erroredEnvelope(run);

      expect(run.exitCode).toBe(2);
      expect(envelope.error).toMatchObject({ code: 'PSL.PRINT_FAILED' });
      expect(envelope.error).not.toHaveProperty('fix');
      expect(envelope.nextActions).toEqual([
        { kind: 'user-choice', label: 'Re-run after fixing the schema' },
      ]);
    });

    it('settles a bare throw as CLI.UNEXPECTED at exit 2, not an engine bug at exit 1', async () => {
      const dir = await projectDir();
      mocks.printPsl.mockReturnValue(PSL);
      // A directory where the schema file belongs makes the staged write throw,
      // which is past the handler's own catch and so reaches the boundary.
      await writeFile(join(dir, 'generated'), 'not a directory', 'utf-8');

      const run = await harness(ormConfig(dir)).run(['contract', 'infer', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(2);
      expect(erroredEnvelope(run).error).toMatchObject({ code: 'CLI.UNEXPECTED' });
    });
  });
});
