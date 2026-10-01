import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaNextConfig } from '@internal/config-loader';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HASH_A = `${'a'.repeat(64)}`;

const config = { migrations: { dir: 'migrations' } } as unknown as PrismaNextConfig;

describe('migration-ref MigrationToolsError envelope passthrough', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `migration-ref-mapping-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const migrationsDir = join(tempDir, 'migrations');
    const refsDir = join(migrationsDir, 'refs');
    await mkdir(refsDir, { recursive: true });
    await writeFile(
      join(refsDir, 'staging.json'),
      `${JSON.stringify({ hash: HASH_A, invariants: [] }, null, 2)}\n`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it(
    'surfaces the MigrationToolsError meta payload unchanged in the envelope',
    async () => {
      const { executeRefDeleteCommand } = await import('../../src/control-api/operations/ref');

      const result = await executeRefDeleteCommand('does-not-exist', {
        config,
        cwd: tempDir,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      const envelope = result.failure.toEnvelope();
      expect(envelope.code).toBe('MIGRATION.UNKNOWN_REF');
      expect(envelope.meta).toMatchObject({
        refName: 'does-not-exist',
      });
      expect(envelope.meta).toHaveProperty('filePath');
      expect(envelope.summary).toContain('does-not-exist');
      expect(envelope.why).toContain('does-not-exist');
      expect(envelope.fix).toBeTypeOf('string');
    },
    timeouts.typeScriptCompilation,
  );
});
