import { mkdir, rm, writeFile } from 'node:fs/promises';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { readRefs, writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMigrationRefs } from '../../src/control-api/operations/refs';
import { createTestProjectDir } from '../utils/test-project-dir';

const HASH_A = `${'a'.repeat(64)}`;

describe('readMigrationRefs', () => {
  let tempDir: string;
  let refsDir: string;

  beforeEach(() => {
    tempDir = createTestProjectDir('read-migration-refs');
    refsDir = join(tempDir, 'refs');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns ok with an empty index when the refs directory is absent', async () => {
    const result = await readMigrationRefs(refsDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it('returns ok with the parsed entries for a populated refs directory', async () => {
    await writeRef(refsDir, 'staging', { hash: HASH_A, invariants: [] });
    const result = await readMigrationRefs(refsDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ staging: { hash: HASH_A, invariants: [] } });
    }
  });

  it('passes a corrupt-ref-file MigrationToolsError through unchanged', async () => {
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'staging.json'), '{not json');

    let thrown: unknown;
    try {
      await readRefs(refsDir);
    } catch (error) {
      thrown = error;
    }
    expect(MigrationToolsError.is(thrown)).toBe(true);

    const result = await readMigrationRefs(refsDir);
    expect(result.ok).toBe(false);
    if (!result.ok && MigrationToolsError.is(thrown)) {
      expect(result.failure.toEnvelope()).toEqual(thrown.toEnvelope());
    }
  });

  it('rethrows non-MigrationToolsError failures', async () => {
    // A plain file where the refs directory should be makes readdir fail with
    // ENOTDIR — not a MigrationToolsError, so the operation rethrows it.
    await mkdir(tempDir, { recursive: true });
    await writeFile(refsDir, 'not a directory');
    await expect(readMigrationRefs(refsDir)).rejects.toThrow();
  });
});
