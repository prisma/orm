import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitContractSpaceArtifacts } from '../src/emit-contract-space-artifacts';
import { MigrationToolsError } from '../src/errors';
import { readContractSpaceHeadRef } from '../src/read-contract-space-head-ref';
import { APP_SPACE_ID } from '../src/space-layout';

describe('readContractSpaceHeadRef', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'read-contract-space-head-ref-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns null when refs/head.json does not exist', async () => {
    expect(await readContractSpaceHeadRef(migrationsDir, 'cipherstash')).toBeNull();
  });

  it('returns null when the migrations directory itself does not exist', async () => {
    const missing = join(migrationsDir, 'nope', 'migrations');
    expect(await readContractSpaceHeadRef(missing, 'cipherstash')).toBeNull();
  });

  it('round-trips with emitContractSpaceArtifacts', async () => {
    const hash = `${'0'.repeat(63)}1`;
    const invariants = ['inv-2', 'inv-1', 'inv-3'];
    await emitContractSpaceArtifacts(migrationsDir, 'cipherstash', {
      contract: { formatVersion: 1, storage: { storageHash: hash }, foo: 1 },
      contractDts: '\n',
      headRef: { hash, invariants },
    });

    const result = await readContractSpaceHeadRef(migrationsDir, 'cipherstash');
    expect(result?.hash).toBe(hash);
    expect(result?.invariants).toEqual(['inv-1', 'inv-2', 'inv-3']);
  });

  it('round-trips for the app space (uniform with extensions)', async () => {
    const hash = 'a'.repeat(64);
    await emitContractSpaceArtifacts(migrationsDir, APP_SPACE_ID, {
      contract: { formatVersion: 1, storage: { storageHash: hash } },
      contractDts: '\n',
      headRef: { hash, invariants: [] },
    });

    const result = await readContractSpaceHeadRef(migrationsDir, APP_SPACE_ID);
    expect(result).toEqual({ hash, invariants: [] });
  });

  it('throws when refs/head.json is missing the invariants array', async () => {
    const dir = join(migrationsDir, 'cipherstash', 'refs');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'head.json'),
      `${canonicalizeJson({ formatVersion: 1, hash: 'abc' })}\n`,
    );

    let captured: unknown;
    try {
      await readContractSpaceHeadRef(migrationsDir, 'cipherstash');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
  });

  describe('format version', () => {
    const headPath = () => join(migrationsDir, 'cipherstash', 'refs', 'head.json');
    async function writeHead(content: Record<string, unknown>): Promise<void> {
      await mkdir(join(migrationsDir, 'cipherstash', 'refs'), { recursive: true });
      await writeFile(headPath(), JSON.stringify(content));
    }

    it('refuses a head ref written by a newer release, naming the file', async () => {
      await writeHead({ formatVersion: 2, hash: 'abc', invariants: [] });
      await expect(readContractSpaceHeadRef(migrationsDir, 'cipherstash')).rejects.toMatchObject({
        code: 'MIGRATION.FORMAT_VERSION_NEWER',
        where: { path: headPath() },
      });
    });

    it('reads a head ref a release candidate wrote with no format version', async () => {
      await writeHead({ hash: 'a'.repeat(64), invariants: [] });
      expect(await readContractSpaceHeadRef(migrationsDir, 'cipherstash')).toEqual({
        hash: 'a'.repeat(64),
        invariants: [],
      });
    });

    it('refuses a head ref with the old schemaVersion field', async () => {
      await writeHead({ schemaVersion: '1', hash: 'abc', invariants: [] });
      await expect(readContractSpaceHeadRef(migrationsDir, 'cipherstash')).rejects.toMatchObject({
        code: 'MIGRATION.FORMAT_VERSION_MISSING',
      });
    });

    it('refuses a head ref with a field it does not know', async () => {
      await writeHead({ formatVersion: 1, hash: 'abc', invariants: [], note: 'x' });
      await expect(readContractSpaceHeadRef(migrationsDir, 'cipherstash')).rejects.toMatchObject({
        code: 'MIGRATION.INVALID_REF_FILE',
      });
    });

    it('refuses a head ref that declares policies', async () => {
      await writeHead({ formatVersion: 1, hash: 'abc', invariants: [], policies: {} });
      await expect(readContractSpaceHeadRef(migrationsDir, 'cipherstash')).rejects.toMatchObject({
        code: 'MIGRATION.INVALID_REF_FILE',
      });
    });
  });

  describe('a hash that is not a contract hash', () => {
    it.each([
      ['a prefixed hash', `sha256:${'a'.repeat(64)}`],
      ['an empty string', ''],
      ['the empty contract', 'empty'],
    ])('refuses %s, naming the file', async (_, hash) => {
      const dir = join(migrationsDir, 'cipherstash', 'refs');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'head.json'),
        JSON.stringify({ formatVersion: 1, hash, invariants: [] }),
      );
      await expect(readContractSpaceHeadRef(migrationsDir, 'cipherstash')).rejects.toMatchObject({
        code: 'MIGRATION.INVALID_REF_FILE',
        meta: { path: join(dir, 'head.json') },
        why: expect.stringContaining(
          `hash must be a contract hash of 64 lowercase hex characters (got "${hash}")`,
        ),
      });
    });
  });

  it('rejects an invalid space id', async () => {
    let captured: unknown;
    try {
      await readContractSpaceHeadRef(migrationsDir, 'NOT VALID');
    } catch (err) {
      captured = err;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
    if (MigrationToolsError.is(captured)) {
      expect(captured.code).toBe('MIGRATION.INVALID_SPACE_ID');
    }
  });
});
