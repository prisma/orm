/**
 * Pins the migration-file CLI's exit-code scheme: 0 for success paths,
 * 1 for runtime errors, 2 for usage errors. The S5 cutover deletes the
 * commander shell and moves the standalone bin onto the CLI engine's
 * settlement codes (errored runs exit 2, findings exit 4) — the
 * clipanion migration-file CLI is explicitly untouched by that change,
 * and this suite is the assertion that its scheme survived.
 *
 * No module mocks: `MigrationCLI.run` takes injected argv and streams,
 * and the runtime-error case drives the real config loader against a
 * path that does not exist.
 */

import { rmSync, writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { Migration } from '@internal/migration-tools/migration';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { MigrationCLI } from '../src/migration-cli';
import { createTestProjectDir } from './utils/test-project-dir';

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

class NoOpMigration extends Migration {
  readonly targetId = 'postgres';
  override get operations() {
    return [];
  }
  override describe() {
    return { from: 'from', to: 'to' };
  }
}

const projectDir = createTestProjectDir('migration-cli-exit-scheme');
const migrationFile = join(projectDir, 'migration.ts');
writeFileSync(migrationFile, '// entrypoint stand-in for MigrationCLI.run\n');
const migrationUrl = pathToFileURL(migrationFile).href;

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function run(args: readonly string[]) {
  const stdout = new BufferStream();
  const stderr = new BufferStream();
  const exitCode = MigrationCLI.run(migrationUrl, NoOpMigration, {
    argv: ['node', migrationFile, ...args],
    stdout,
    stderr,
  });
  return { exitCode, stdout, stderr };
}

describe('migration-file CLI exit scheme (0/1/2)', () => {
  it('exits 0 for --help', async () => {
    const { exitCode, stdout } = run(['--help']);
    expect(await exitCode).toBe(0);
    expect(stdout.text).toContain('migration.ts');
  });

  it('exits 0 when imported rather than executed', async () => {
    const stdout = new BufferStream();
    const stderr = new BufferStream();
    const exitCode = await MigrationCLI.run(migrationUrl, NoOpMigration, {
      argv: ['node', join(projectDir, 'some-other-entrypoint.ts')],
      stdout,
      stderr,
    });
    expect(exitCode).toBe(0);
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe('');
  });

  it('exits 1 for a runtime error (config file not found)', async () => {
    const { exitCode, stderr } = run(['--config', join(projectDir, 'does-not-exist.config.ts')]);
    expect(await exitCode).toBe(1);
    expect(stderr.text).toContain('CONFIG.FILE_NOT_FOUND');
  });

  it('exits 2 for an unknown flag', async () => {
    const { exitCode, stderr } = run(['--frobnicate']);
    expect(await exitCode).toBe(2);
    expect(stderr.text).toContain('CLI.UNKNOWN_FLAG');
  });

  it('exits 2 for --config without a path', async () => {
    const { exitCode, stderr } = run(['--config']);
    expect(await exitCode).toBe(2);
    expect(stderr.text).toContain('CLI.CONFIG_ARG_MISSING_PATH');
  });
});
