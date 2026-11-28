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
  const releaseCandidate = { schemaVersion: '1', storage: { storageHash: STORAGE_HASH } };
  const converted = { formatVersion: 1, storage: { storageHash: STORAGE_HASH } };
  const unversioned = { storage: { storageHash: STORAGE_HASH } };

  it('is refused by the strict read when a newer release wrote it, naming the file', async () => {
    await writeSnapshot(newer);
    await expect(readContractSnapshotJson(migrationsDir, STORAGE_HASH)).rejects.toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_NEWER',
      where: { path: jsonPath() },
    });
  });

  it('is read by the strict read in the newest version when a release candidate wrote it, leaving the file as it is', async () => {
    await writeSnapshot(releaseCandidate);
    expect(await readContractSnapshotJson(migrationsDir, STORAGE_HASH)).toEqual(converted);
    expect(JSON.parse(await readFile(jsonPath(), 'utf8'))).toEqual(releaseCandidate);
  });

  it('is refused by the strict read when it has no version field at all, advising a restore and not an emit', async () => {
    await writeSnapshot(unversioned);
    await expect(readContractSnapshotJson(migrationsDir, STORAGE_HASH)).rejects.toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
      message: `The contract snapshot "${jsonPath()}" has no format version`,
      nextActions: [{ kind: 'user-choice', label: 'Restore the snapshot from version control' }],
    });
  });

  it('is written in the newest version when the contract given is one a release candidate wrote', async () => {
    await writeContractSnapshot(migrationsDir, STORAGE_HASH, {
      contractJson: releaseCandidate,
      contractDts: '',
    });
    expect(JSON.parse(await readFile(jsonPath(), 'utf8'))).toEqual(converted);
  });

  it('is never treated as absent by the tolerant read', async () => {
    await writeSnapshot(newer);
    await expect(
      readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH),
    ).rejects.toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_NEWER', where: { path: jsonPath() } });
  });

  it('is read by the tolerant read in the newest version when a release candidate wrote it', async () => {
    await writeSnapshot(releaseCandidate);
    expect(await readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH)).toEqual(converted);
  });

  it('is refused by the tolerant read when it has no version field at all', async () => {
    await writeSnapshot(unversioned);
    await expect(
      readContractSnapshotJsonTolerant(migrationsDir, STORAGE_HASH),
    ).rejects.toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
      nextActions: [{ kind: 'user-choice', label: 'Restore the snapshot from version control' }],
    });
  });
});
