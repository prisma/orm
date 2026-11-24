import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contractSnapshotDir,
  readContractSnapshotJson,
  readContractSnapshotJsonTolerant,
} from '../src/contract-snapshot-store';

const STORAGE_HASH = 'e'.repeat(64);

describe('contract snapshot format version', () => {
  let migrationsDir: string;
  const jsonPath = () => join(contractSnapshotDir(migrationsDir, STORAGE_HASH), 'contract.json');

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'snapshot-format-version-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  async function writeSnapshot(document: Record<string, unknown>): Promise<void> {
    await mkdir(contractSnapshotDir(migrationsDir, STORAGE_HASH), { recursive: true });
    await writeFile(jsonPath(), JSON.stringify(document));
  }

  const newer = { formatVersion: 2, storage: { storageHash: STORAGE_HASH } };
  const preRelease = { schemaVersion: '1', storage: { storageHash: STORAGE_HASH } };

  it('is refused by the strict read when a newer release wrote it, naming the file', async () => {
    await writeSnapshot(newer);
    await expect(readContractSnapshotJson(migrationsDir, STORAGE_HASH)).rejects.toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_NEWER',
      where: { path: jsonPath() },
    });
  });

  it('is refused by the strict read when a pre-release wrote it', async () => {
    await writeSnapshot(preRelease);
    await expect(readContractSnapshotJson(migrationsDir, STORAGE_HASH)).rejects.toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
    });
  });

  it('is never treated as absent by the tolerant read', async () => {
    await writeSnapshot(newer);
    await expect(
      readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH),
    ).rejects.toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_NEWER', where: { path: jsonPath() } });
  });

  it('is refused by the tolerant read when a pre-release wrote it', async () => {
    await writeSnapshot(preRelease);
    await expect(
      readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH),
    ).rejects.toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_MISSING' });
  });
});
