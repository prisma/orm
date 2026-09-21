/**
 * Unit tests for `MigrationCLI.run` (the migration-file CLI entrypoint).
 *
 * Test-doubles approach: `BufferStream` collects output written via
 * `write`/`end`; `argv` is injected explicitly. No `process.argv` /
 * `process.stdout` / `process.stderr` mutation, no `vi.spyOn` on
 * process globals — the public surface accepts an injectable
 * `{ argv, stdout, stderr }` so tests can capture in-process.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { errorConfigFileNotFound } from '@internal/errors/control';
import { Migration } from '@internal/migration-tools/migration';
import { notOk, ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadConfigMock = vi.fn();
const createControlStackMock = vi.fn();

vi.mock('@internal/config-loader', () => ({
  loadConfigForSections: loadConfigMock,
}));

vi.mock('@internal/framework-components/control', async () => {
  const actual = await vi.importActual<typeof import('@internal/framework-components/control')>(
    '@internal/framework-components/control',
  );
  return { ...actual, createControlStack: createControlStackMock };
});

vi.resetModules();
const { MigrationCLI } = await import('../src/migration-cli');

/**
 * `node:stream.Writable` subclass that captures every chunk written to
 * it so assertions can use `.toContain(...)` / `.toMatch(...)` on the
 * accumulated text. Subclasses `Writable` (rather than implementing the
 * stream interface ad-hoc) because clipanion's `BaseContext.stdout` and
 * `BaseContext.stderr` are typed as `Writable`, and the migration-file
 * CLI forwards the injected streams into clipanion's context.
 */
class BufferStream extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    callback();
  }

  get text(): string {
    return this.chunks.join('');
  }
}

class FakeMigration extends Migration {
  readonly targetId: string;
  constructor(stack: unknown, targetId = 'postgres') {
    super(stack as never);
    this.targetId = targetId;
  }
  override get operations() {
    return [];
  }
  override describe() {
    return { from: 'from', to: 'to' };
  }
}

class WrongTargetMigration extends Migration {
  readonly targetId = 'mongo' as const;
  constructor(stack: unknown) {
    super(stack as never);
  }
  override get operations() {
    return [];
  }
  override describe() {
    return { from: 'from', to: 'to' };
  }
}

/**
 * Mirrors `PostgresMigration`'s constructor side effect: when given a
 * stack, eagerly invokes `stack.adapter.create(stack)` to materialize a
 * control adapter. Used to assert that `MigrationCLI.run` never
 * constructs a wrong-target migration with the assembled stack — the
 * static `stackUsed` flag stays `false` when the target-mismatch guard
 * fires before stack construction.
 */
class StackHungryWrongTargetMigration extends Migration {
  readonly targetId = 'mongo' as const;
  static stackUsed = false;
  constructor(stack?: unknown) {
    super(stack as never);
    if (stack !== undefined) {
      StackHungryWrongTargetMigration.stackUsed = true;
      (stack as { adapter: { create: (s: unknown) => unknown } }).adapter.create(stack);
    }
  }
  override get operations() {
    return [];
  }
  override describe() {
    return { from: 'from', to: 'to' };
  }
}

let workDir: string;
let migrationFile: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'migrationcli-test-'));
  migrationFile = join(workDir, 'migration.ts');
  // The serializer needs an actual file at the migration path so that
  // realpathSync resolves both sides identically when the entrypoint
  // guard compares `realpathSync(import.meta.url)` against
  // `realpathSync(argv[1])`.
  writeFileSync(migrationFile, '');
  loadConfigMock.mockReset();
  createControlStackMock.mockReset();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Returns the canonical "looks like an entrypoint invocation" argv
 * shape: `['node', migrationFile, ...extra]`. The entrypoint guard
 * compares `realpathSync(import.meta.url)` to `realpathSync(argv[1])`,
 * so pointing `argv[1]` at the temp file makes the guard fire and the
 * runner executes its body.
 */
function entrypointArgv(...extra: readonly string[]): readonly string[] {
  return ['node', migrationFile, ...extra];
}

const okConfig = {
  family: { familyId: 'sql' },
  target: { targetId: 'postgres' },
  adapter: { kind: 'adapter' },
  extensions: [],
};

describe('MigrationCLI.run', () => {
  it('writes ops.json + migration.json under the migration directory on success', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    const ops = JSON.parse(readFileSync(join(workDir, 'ops.json'), 'utf-8'));
    expect(ops).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(workDir, 'migration.json'), 'utf-8'));
    expect(manifest).toMatchObject({ from: 'from', to: 'to' });
  });

  it('prints artifacts to stdout in --dry-run mode without writing files', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--dry-run'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(() => readFileSync(join(workDir, 'ops.json'))).toThrow();
    expect(stdout.text).toContain('--- migration.json ---');
    expect(stdout.text).toContain('--- ops.json ---');
  });

  it('emits MIGRATION.TARGET_MISMATCH with both target ids when migration target ≠ config target', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(
      pathToFileURL(migrationFile).href,
      WrongTargetMigration,
      { argv: entrypointArgv(), stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('"mongo"');
    expect(stderr.text).toContain('"postgres"');
    expect(stderr.text).toContain('Migration target does not match config target');
  });

  it('exits non-zero with the loader diagnostic when config is missing', async () => {
    loadConfigMock.mockResolvedValue(notOk(errorConfigFileNotFound('/path/to/prisma.config.ts')));
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toMatch(/config|prisma/i);
  });

  it('no-ops silently when the file is being imported (not the entrypoint)', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: ['node', '/some/other/file.js'],
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(() => readFileSync(join(workDir, 'ops.json'))).toThrow();
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe('');
  });

  // A `migration.ts` file may execute other code alongside `MigrationCLI.run`
  // — most realistically, an unhandled rejection or an explicit
  // `process.exitCode = N` somewhere upstream that signals a prior failure.
  // The CLI must not clobber that signal: a successful migration write
  // should not turn a previously-failing process into a successful one.
  it('preserves a pre-existing non-zero process.exitCode on success', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const originalExitCode = process.exitCode;
    process.exitCode = 7;
    try {
      const stdout = new BufferStream();
      const stderr = new BufferStream();
      const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
        argv: entrypointArgv(),
        stdout,
        stderr,
      });
      expect(exitCode).toBe(0);
      expect(process.exitCode).toBe(7);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  // A failure inside `MigrationCLI.run` must still set `process.exitCode`
  // for script-style callers that don't await the return value, even when
  // there's no prior non-zero status.
  it('sets process.exitCode on failure when no prior status was set', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const stdout = new BufferStream();
      const stderr = new BufferStream();
      const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
        argv: entrypointArgv('--frobnicate'),
        stdout,
        stderr,
      });
      expect(exitCode).toBe(2);
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it('renders --help to stdout and exits 0', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--help'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stdout.text).toContain('Usage');
  });

  it('routes --help output to stdout, never to stderr', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--help'),
      stdout,
      stderr,
    });

    // Regression guard for the corrected Style Guide rule 8: explicit
    // `--help` is data, so it must land on stdout. Help text on stderr
    // would break shell pipelines that consume it as data.
    expect(stderr.text).not.toContain('Usage');
  });

  it('forwards --config <path> to loadConfig', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config', '/explicit/config.ts'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).toHaveBeenCalledWith('/explicit/config.ts', expect.any(Array));
  });

  it('forwards --config=<path> (equals form) to loadConfig', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config=/equals/config.ts'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).toHaveBeenCalledWith('/equals/config.ts', expect.any(Array));
  });

  it('preserves createdAt from a previously-scaffolded migration.json', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const existing = {
      from: 'from',
      to: 'to',
      migrationHash: null,
      createdAt: '2026-01-15T10:00:00.000Z',
    };
    writeFileSync(join(workDir, 'migration.json'), JSON.stringify(existing, null, 2));

    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    const manifest = JSON.parse(readFileSync(join(workDir, 'migration.json'), 'utf-8'));
    expect(manifest.createdAt).toBe(existing.createdAt);
    // Even though the on-disk fixture started with `migrationHash: null`,
    // MigrationCLI.run must rewrite it to a real `...` digest —
    // otherwise readMigrationPackage() would reject the package.
    expect(manifest.migrationHash).toMatch(/^/);
  });

  it('exits non-zero with MIGRATION.INVALID_JSON when migration.json is unparseable', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const malformed = '{ this is not json';
    writeFileSync(join(workDir, 'migration.json'), malformed);

    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.text).toContain('Invalid JSON in migration file');
    expect(stderr.text).toContain(join(workDir, 'migration.json'));

    expect(() => readFileSync(join(workDir, 'ops.json'))).toThrow();

    const onDisk = readFileSync(join(workDir, 'migration.json'), 'utf-8');
    expect(onDisk).toBe(malformed);
  });

  it('rejects --config when followed by another flag with CLI.CONFIG_ARG_MISSING_PATH and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config', '--dry-run'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('CLI.CONFIG_ARG_MISSING_PATH');
    expect(stderr.text).toContain('--config');
    expect(stderr.text).toContain('--dry-run');
  });

  it('rejects a bare trailing --config with CLI.CONFIG_ARG_MISSING_PATH and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('CLI.CONFIG_ARG_MISSING_PATH');
    expect(stderr.text).toContain('--config');
  });

  // `--config=` (equals form, empty value) is a usage error: the user
  // expressed intent to override the config path but the override is
  // empty. Loader behaviour for an empty path is implementation-defined
  // and worse for the user than a structured CLI.CONFIG_ARG_MISSING_PATH.
  it('rejects --config= (equals form, empty value) with CLI.CONFIG_ARG_MISSING_PATH and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config='),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('CLI.CONFIG_ARG_MISSING_PATH');
  });

  // `--config ""` (separated form, empty string token) is the same kind
  // of usage error as `--config=`. Shells expand `""` into a real
  // (empty) argv token, so this is what an author hits in practice
  // when scripting `--config "$MAYBE_UNSET_VAR"`.
  it('rejects --config "" (separated form, empty string) with CLI.CONFIG_ARG_MISSING_PATH and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--config', ''),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('CLI.CONFIG_ARG_MISSING_PATH');
  });

  it('rejects target-mismatched migrations before any stack-driven construction', async () => {
    loadConfigMock.mockResolvedValue(ok(okConfig));
    const adapterCreate = vi.fn(() => ({}));
    createControlStackMock.mockReturnValue({ adapter: { create: adapterCreate } });
    StackHungryWrongTargetMigration.stackUsed = false;

    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(
      pathToFileURL(migrationFile).href,
      StackHungryWrongTargetMigration,
      { argv: entrypointArgv(), stdout, stderr },
    );

    expect(exitCode).toBe(1);
    expect(StackHungryWrongTargetMigration.stackUsed).toBe(false);
    expect(adapterCreate).not.toHaveBeenCalled();
  });

  it('rejects unknown flags with CLI.UNKNOWN_FLAG and exit 2', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();

    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv('--frobnicate'),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(stderr.text).toContain('CLI.UNKNOWN_FLAG');
    expect(stderr.text).toContain('--frobnicate');
    // The known-flag list should be rendered for copy-pastability so
    // the user can spot the typo without `--help`.
    expect(stderr.text).toContain('--help');
    expect(stderr.text).toContain('--dry-run');
    expect(stderr.text).toContain('--config');
  });

  it('uses injected argv exclusively, never reading process.argv', async () => {
    // Regression guard for the stream-injection contract: when argv is
    // injected, the runner must not fall back to process.argv. In
    // vitest, process.argv[1] points at vitest's own binary — if the
    // implementation read it, the entrypoint guard
    // (realpathSync(argv[1]) === realpathSync(importMetaUrl)) would
    // not match and the runner would silently no-op, leaving
    // loadConfigMock uncalled. The injected argv points argv[1] at
    // migrationFile, so the guard fires and loadConfig is called.
    loadConfigMock.mockResolvedValue(ok(okConfig));
    createControlStackMock.mockReturnValue({ adapter: { create: () => ({}) } });

    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(pathToFileURL(migrationFile).href, FakeMigration, {
      argv: entrypointArgv(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).toHaveBeenCalled();
  });
});
