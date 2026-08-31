import { CliStructuredError } from '@internal/errors/control';
import type { ErroredEnvelope, LoadedConfig, MountedTree, StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractEmitResult } from '../../src/control-api/types';
import { BIN_GROUPS } from '../../src/orm/cli';
import type { ContractEmitCommandDeps } from '../../src/orm/contract/emit';
import { createContractEmitCommand } from '../../src/orm/contract/emit';

/**
 * The command is mounted from the factory with the operation injected, so no
 * module mocking is involved and the double is scoped to this file.
 */
const executeContractEmit = vi.fn<ContractEmitCommandDeps['executeContractEmit']>();

const commands: MountedTree = {
  'contract emit': createContractEmitCommand({ executeContractEmit }),
};
const groups = BIN_GROUPS;

const PROJECT_DIR = '/workspace/app';
const OUTPUT_DIR = join(PROJECT_DIR, 'generated');

function emitResult(overrides: Record<string, unknown> = {}): ContractEmitResult {
  return {
    storageHash: 'storage-hash',
    executionHash: 'execution-hash',
    profileHash: 'profile-hash',
    files: {
      json: join(OUTPUT_DIR, 'contract.json'),
      dts: join(OUTPUT_DIR, 'contract.d.ts'),
    },
    ...overrides,
  } as ContractEmitResult;
}

beforeEach(() => {
  executeContractEmit.mockReset().mockResolvedValue(emitResult());
});

/**
 * The config the loader hands back, with `contract.output` absolute as the
 * ORM's loader leaves it after resolving against the config file's directory.
 */
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
      source: { format: 'typescript', inputs: [], load: () => ({ ok: true, value: {} }) },
      output: join(OUTPUT_DIR, 'contract.json'),
    },
    ...overrides,
  };
}

function harness(config: Record<string, unknown> = ormConfig()) {
  return createTestCli({ commands, groups, config: { orm: config } });
}

function erroredEnvelope(run: { readonly json: readonly StreamEvent[] }): ErroredEnvelope {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    throw new Error('the run did not settle as an errored envelope');
  }
  return terminal.envelope;
}

/** A loader that records every call, so a second config load is visible. */
function countingLoader(config: Record<string, unknown> = ormConfig()): {
  readonly calls: string[];
  readonly loadConfig: (configPath?: string) => Promise<LoadedConfig>;
} {
  const calls: string[] = [];
  return {
    calls,
    loadConfig: (configPath) => {
      calls.push(configPath ?? '(none)');
      return Promise.resolve({
        files: [{ path: join(PROJECT_DIR, 'prisma.config.ts'), sections: { orm: config } }],
        diagnostics: [],
      });
    },
  };
}

describe('contract emit', () => {
  it('settles as a completed envelope carrying the emit document', async () => {
    const run = await harness().run(['contract', 'emit', '--json'], { cwd: PROJECT_DIR });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: true, exitCode: 0 } });
    expect(run.presented?.data).toEqual({
      ok: true,
      storageHash: 'storage-hash',
      executionHash: 'execution-hash',
      profileHash: 'profile-hash',
      outDir: OUTPUT_DIR,
      files: {
        json: join(OUTPUT_DIR, 'contract.json'),
        dts: join(OUTPUT_DIR, 'contract.d.ts'),
      },
      timings: { total: expect.any(Number) },
    });
  });

  it('hands the operation the config the engine already loaded', async () => {
    const config = ormConfig();

    await harness(config).run(['contract', 'emit', '--json'], { cwd: PROJECT_DIR });

    expect(executeContractEmit).toHaveBeenCalledTimes(1);
    expect(executeContractEmit.mock.calls[0]?.[0]).toMatchObject({
      config,
      cwd: PROJECT_DIR,
    });
  });

  it('loads the config exactly once for a run', async () => {
    const loader = countingLoader();

    const run = await createTestCli({ commands, groups, loadConfig: loader.loadConfig }).run(
      ['contract', 'emit', '--json'],
      { cwd: PROJECT_DIR },
    );

    expect(run.exitCode).toBe(0);
    expect(loader.calls).toEqual(['(none)']);
  });

  it('anchors the emitted artifacts on the config file rather than the process directory', async () => {
    await harness().run(['contract', 'emit', '--json'], { cwd: '/somewhere/else' });

    const call = executeContractEmit.mock.calls[0]?.[0];
    expect(call?.outputPath).toBeUndefined();
    expect(process.cwd()).not.toBe(PROJECT_DIR);
  });

  it('resolves a relative --output-path against the invocation directory', async () => {
    await harness().run(['contract', 'emit', '--output-path', 'custom/dir', '--json'], {
      cwd: PROJECT_DIR,
    });

    expect(executeContractEmit.mock.calls[0]?.[0]).toMatchObject({
      outputPath: join(PROJECT_DIR, 'custom/dir'),
    });
  });

  it('passes an absolute --output-path verbatim', async () => {
    await harness().run(['contract', 'emit', '--output-path', '/tmp/abs-out', '--json'], {
      cwd: PROJECT_DIR,
    });

    expect(executeContractEmit.mock.calls[0]?.[0]).toMatchObject({
      outputPath: '/tmp/abs-out',
    });
  });

  it('writes the emitted paths to stdout and the prose to stderr', async () => {
    // Only stdout is a terminal. Marking stderr one too makes the engine read
    // the pair as a single screen and drop the stdout mirror to avoid drawing
    // it twice; leaving stdout off a terminal switches it to the JSON stream.
    const run = await harness().run(['contract', 'emit'], {
      cwd: PROJECT_DIR,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.stdout).toEqual([
      join(OUTPUT_DIR, 'contract.json'),
      join(OUTPUT_DIR, 'contract.d.ts'),
    ]);
    expect(run.stdout).toBe(
      `${join(OUTPUT_DIR, 'contract.json')}\n${join(OUTPUT_DIR, 'contract.d.ts')}\n`,
    );
  });

  it('ships the header, the outcome and the hashes as blocks', async () => {
    const run = await harness().run(['contract', 'emit'], {
      cwd: PROJECT_DIR,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: 'generated/contract.json' },
          { label: 'types', value: 'generated/contract.d.ts' },
        ],
      },
      { kind: 'summary', status: 'ok', text: 'Emitted contract.json and contract.d.ts' },
      {
        kind: 'fields',
        rows: [
          { label: 'storageHash', value: [{ text: 'storage-hash', tone: 'identifier' }] },
          { label: 'executionHash', value: [{ text: 'execution-hash', tone: 'identifier' }] },
          { label: 'profileHash', value: [{ text: 'profile-hash', tone: 'identifier' }] },
        ],
      },
    ]);
  });

  it('renders the blocks to stderr with the hashes lined up', async () => {
    const run = await harness().run(['contract', 'emit'], {
      cwd: PROJECT_DIR,
      isTty: { stdout: true, stderr: true },
      columns: { stderr: 100 },
    });
    const rendered = stripAnsi(run.stderr).split('\n');
    const storage = rendered.find((line) => line.includes('storage-hash'));
    const profile = rendered.find((line) => line.includes('profile-hash'));

    expect(stripAnsi(run.stderr)).toContain('generated/contract.json');
    expect(stripAnsi(run.stderr)).toContain('Emitted contract.json and contract.d.ts');
    expect(storage).toBeDefined();
    expect(profile).toBeDefined();
    expect(storage?.indexOf('storage-hash')).toBe(profile?.indexOf('profile-hash'));
  });

  it('omits the execution hash the emitter did not produce', async () => {
    executeContractEmit.mockResolvedValue(emitResult({ executionHash: undefined }));

    const run = await harness().run(['contract', 'emit', '--json'], { cwd: PROJECT_DIR });

    expect(run.presented?.data).not.toHaveProperty('executionHash');
  });

  it('reports the operation spans as engine steps', async () => {
    executeContractEmit.mockImplementation((options) => {
      options.onProgress?.({
        action: 'emit',
        kind: 'spanStart',
        spanId: 'resolveSource',
        label: 'Resolving contract source...',
      });
      options.onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'resolveSource',
        outcome: 'ok',
      });
      return Promise.resolve(emitResult());
    });

    const run = await harness().run(['contract', 'emit', '--json'], { cwd: PROJECT_DIR });

    expect(run.events).toEqual([
      { kind: 'step-started', step: 'Resolving contract source...', id: 'resolveSource' },
      {
        kind: 'step-finished',
        step: 'Resolving contract source...',
        id: 'resolveSource',
        outcome: 'ok',
      },
      {
        kind: 'message',
        severity: 'verbose',
        text: expect.stringMatching(/^Total time: \d+ms$/),
      },
    ]);
  });

  it('reports the emitter dependency warning as a warning event', async () => {
    executeContractEmit.mockResolvedValue(
      emitResult({ validationWarning: 'sample dependency warning' }),
    );

    const run = await harness().run(['contract', 'emit', '--json'], { cwd: PROJECT_DIR });

    expect(run.exitCode).toBe(0);
    expect(run.events).toContainEqual({
      kind: 'message',
      severity: 'warn',
      text: 'sample dependency warning',
    });
  });

  it('keeps the dotted code of an error the operation raised', async () => {
    const { errorRuntime } = await import('@internal/errors/execution');
    executeContractEmit.mockRejectedValue(
      errorRuntime('CONTRACT.SOURCE_LOAD_FAILED', 'Failed to resolve contract source', {
        why: 'the provider threw',
        fix: 'Fix the contract source and re-run',
      }),
    );

    const run = await harness().run(['contract', 'emit', '--json'], { cwd: PROJECT_DIR });
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: 'CONTRACT.SOURCE_LOAD_FAILED', why: 'the provider threw' },
    });
    expect(envelope?.nextActions).toEqual([
      { kind: 'user-choice', label: 'Fix the contract source and re-run' },
    ]);
  });

  /**
   * `defineOrmCommand` catches at the top of the handler. Without it the engine
   * settles the throw itself: it accepts prisma/prisma's `CliStructuredError`
   * on the name alone and emits the non-protocol `fix` field, and it settles
   * anything else as an engine bug at exit 1.
   */
  describe('the ORM error boundary', () => {
    it('turns a prisma/prisma structured error into a protocol envelope', async () => {
      executeContractEmit.mockRejectedValue(
        new CliStructuredError('CONTRACT.SOURCE_LOAD_FAILED', 'Failed to resolve contract source', {
          fix: 'Fix the contract source and re-run',
        }),
      );

      const run = await harness().run(['contract', 'emit', '--json'], { cwd: PROJECT_DIR });
      const envelope = erroredEnvelope(run);

      expect(run.exitCode).toBe(2);
      expect(envelope.error).toMatchObject({ code: 'CONTRACT.SOURCE_LOAD_FAILED' });
      expect(envelope.error).not.toHaveProperty('fix');
      expect(envelope.nextActions).toEqual([
        { kind: 'user-choice', label: 'Fix the contract source and re-run' },
      ]);
    });

    it('settles a bare throw as CLI.UNEXPECTED at exit 2, not an engine bug at exit 1', async () => {
      executeContractEmit.mockRejectedValue(new Error('the emitter crashed'));

      const run = await harness().run(['contract', 'emit', '--json'], { cwd: PROJECT_DIR });

      expect(run.exitCode).toBe(2);
      expect(erroredEnvelope(run).error).toMatchObject({
        code: 'CLI.UNEXPECTED',
        summary: 'the emitter crashed',
      });
    });
  });
});
