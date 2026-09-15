import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contractSnapshotDir,
  readContractSnapshotJson,
  readContractSnapshotJsonTolerant,
  writeContractSnapshot,
} from '../src/contract-snapshot-store';
import { MigrationToolsError } from '../src/errors';

const HASH_HEX = 'a'.repeat(64);
const STORAGE_HASH = HASH_HEX;
const OTHER_HASH = 'b'.repeat(64);

function contractFixture(storageHash: string) {
  return { storage: { storageHash }, target: 'postgres' };
}

describe('writeContractSnapshot', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'contract-snapshot-store-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('writes a fresh snapshot and returns { written: true, dir }', async () => {
    const result = await writeContractSnapshot(migrationsDir, STORAGE_HASH, {
      contractJson: contractFixture(STORAGE_HASH),
      contractDts: 'export type Contract = {};',
    });

    expect(result.written).toBe(true);
    expect(result.dir).toBe(contractSnapshotDir(migrationsDir, STORAGE_HASH));

    const json = await readFile(join(result.dir, 'contract.json'), 'utf-8');
    // Canonicalized: object keys sorted lexicographically at every level.
    expect(json).toBe(
      '{"storage":{"storageHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"target":"postgres"}\n',
    );

    const dts = await readFile(join(result.dir, 'contract.d.ts'), 'utf-8');
    expect(dts).toBe('export type Contract = {};\n');
  });

  it('does not append a second trailing newline when contractDts already ends with one', async () => {
    const result = await writeContractSnapshot(migrationsDir, STORAGE_HASH, {
      contractJson: contractFixture(STORAGE_HASH),
      contractDts: 'export type Contract = {};\n',
    });

    const dts = await readFile(join(result.dir, 'contract.d.ts'), 'utf-8');
    expect(dts).toBe('export type Contract = {};\n');
  });

  it('skips writing and returns { written: false } when the dir already exists', async () => {
    await writeContractSnapshot(migrationsDir, STORAGE_HASH, {
      contractJson: contractFixture(STORAGE_HASH),
      contractDts: 'export type Contract = {};',
    });

    const beforeJson = await readFile(
      join(contractSnapshotDir(migrationsDir, STORAGE_HASH), 'contract.json'),
      'utf-8',
    );
    const beforeDts = await readFile(
      join(contractSnapshotDir(migrationsDir, STORAGE_HASH), 'contract.d.ts'),
      'utf-8',
    );

    const second = await writeContractSnapshot(migrationsDir, STORAGE_HASH, {
      contractJson: { storage: { storageHash: STORAGE_HASH }, target: 'sqlite' },
      contractDts: 'export type Contract = { different: true };',
    });

    expect(second.written).toBe(false);

    const afterJson = await readFile(
      join(contractSnapshotDir(migrationsDir, STORAGE_HASH), 'contract.json'),
      'utf-8',
    );
    const afterDts = await readFile(
      join(contractSnapshotDir(migrationsDir, STORAGE_HASH), 'contract.d.ts'),
      'utf-8',
    );

    expect(afterJson).toBe(beforeJson);
    expect(afterDts).toBe(beforeDts);
  });

  it('throws MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH when the contract inner hash disagrees', async () => {
    await expect(
      writeContractSnapshot(migrationsDir, STORAGE_HASH, {
        contractJson: contractFixture(OTHER_HASH),
        contractDts: 'export type Contract = {};',
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH',
      }),
    );
  });

  it('throws a plain Error on a malformed storageHash', async () => {
    await expect(
      writeContractSnapshot(migrationsDir, 'not-a-hash', {
        contractJson: contractFixture('not-a-hash'),
        contractDts: 'export type Contract = {};',
      }),
    ).rejects.toThrow();
  });
});

describe('readContractSnapshotJson', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'contract-snapshot-store-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('reads back a written snapshot', async () => {
    await writeContractSnapshot(migrationsDir, STORAGE_HASH, {
      contractJson: contractFixture(STORAGE_HASH),
      contractDts: 'export type Contract = {};',
    });

    const json = await readContractSnapshotJson(migrationsDir, STORAGE_HASH);

    expect(json).toEqual(contractFixture(STORAGE_HASH));
  });

  it('throws MIGRATION.CONTRACT_SNAPSHOT_MISSING naming the hash and expected path when absent', async () => {
    const expectedPath = join(contractSnapshotDir(migrationsDir, STORAGE_HASH), 'contract.json');

    await expect(readContractSnapshotJson(migrationsDir, STORAGE_HASH)).rejects.toThrow(
      expect.objectContaining({
        code: 'MIGRATION.CONTRACT_SNAPSHOT_MISSING',
        why: expect.stringContaining(STORAGE_HASH),
      }),
    );
    await expect(readContractSnapshotJson(migrationsDir, STORAGE_HASH)).rejects.toThrow(
      expect.objectContaining({
        why: expect.stringContaining(expectedPath),
      }),
    );
  });

  it('throws MIGRATION.INVALID_JSON when the file is unparseable', async () => {
    const dir = contractSnapshotDir(migrationsDir, STORAGE_HASH);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'contract.json'), 'not json');

    await expect(readContractSnapshotJson(migrationsDir, STORAGE_HASH)).rejects.toThrow(
      expect.objectContaining({ code: 'MIGRATION.INVALID_JSON' }),
    );
  });
});

describe('readContractSnapshotJsonTolerant', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'contract-snapshot-store-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns the parsed value when present', async () => {
    await writeContractSnapshot(migrationsDir, STORAGE_HASH, {
      contractJson: contractFixture(STORAGE_HASH),
      contractDts: 'export type Contract = {};',
    });

    const json = await readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH);

    expect(json).toEqual(contractFixture(STORAGE_HASH));
  });

  it('returns undefined when the entry is missing', async () => {
    const json = await readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH);

    expect(json).toBeUndefined();
  });

  it('returns undefined when the file is unparseable', async () => {
    const dir = contractSnapshotDir(migrationsDir, STORAGE_HASH);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'contract.json'), 'not json');

    const json = await readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH);

    expect(json).toBeUndefined();
  });

  it('returns undefined when the file contains the JSON literal null', async () => {
    const dir = contractSnapshotDir(migrationsDir, STORAGE_HASH);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'contract.json'), 'null');

    const json = await readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH);

    expect(json).toBeUndefined();
  });

  it('returns undefined when storageHash is not a well-formed 64-hex value', async () => {
    const json = await readContractSnapshotJsonTolerant(migrationsDir, 'short-placeholder');

    expect(json).toBeUndefined();
  });

  it('propagates a non-ENOENT fs error instead of swallowing it', async () => {
    const dir = contractSnapshotDir(migrationsDir, STORAGE_HASH);
    // A directory where contract.json is expected produces a real EISDIR on
    // read — a genuine non-ENOENT errno, distinct from a missing entry.
    await mkdir(join(dir, 'contract.json'), { recursive: true });

    await expect(readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH)).rejects.toThrow(
      expect.objectContaining({ code: 'EISDIR' }),
    );
  });
});

describe('MigrationToolsError shape on contract snapshot errors', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'contract-snapshot-store-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('is a MigrationToolsError instance', async () => {
    try {
      await readContractSnapshotJson(migrationsDir, STORAGE_HASH);
      expect.unreachable('expected readContractSnapshotJson to throw');
    } catch (error) {
      expect(MigrationToolsError.is(error)).toBe(true);
    }
  });
});
