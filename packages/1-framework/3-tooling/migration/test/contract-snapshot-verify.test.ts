import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { computeStorageHash } from '@internal/contract/hashing';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contractSnapshotDir,
  createSnapshotContentVerifier,
  readContractSnapshotJson,
  readContractSnapshotJsonTolerant,
  writeContractSnapshot,
} from '../src/contract-snapshot-store';
import { MigrationToolsError } from '../src/errors';

const TARGET = 'postgres';
const TARGET_FAMILY = 'sql';

function genuineContract(storage: Record<string, unknown>) {
  const storageHash = computeStorageHash({ target: TARGET, targetFamily: TARGET_FAMILY, storage });
  return {
    contractJson: {
      storage: { ...storage, storageHash },
      target: TARGET,
      targetFamily: TARGET_FAMILY,
    },
    storageHash: storageHash as string,
  };
}

describe('createSnapshotContentVerifier', () => {
  it('accepts a contract whose content reproduces its storage hash', () => {
    const { contractJson, storageHash } = genuineContract({ namespaces: {} });

    const verifier = createSnapshotContentVerifier();

    expect(() =>
      verifier.assertSnapshotContentMatches(contractJson, storageHash, '/store/contract.json'),
    ).not.toThrow();
  });

  it('throws CONTRACT_SNAPSHOT_CONTENT_MISMATCH naming the file and both hashes', () => {
    const { contractJson, storageHash } = genuineContract({ namespaces: {} });
    const tampered = {
      ...contractJson,
      storage: { ...contractJson.storage, namespaces: { sneaky: { entries: {} } } },
    };

    const verifier = createSnapshotContentVerifier();
    let thrown: unknown;
    try {
      verifier.assertSnapshotContentMatches(tampered, storageHash, '/store/contract.json');
    } catch (error) {
      thrown = error;
    }

    expect(MigrationToolsError.is(thrown)).toBe(true);
    const error = thrown as MigrationToolsError;
    expect(error.code).toBe('MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH');
    expect(error.why).toContain('/store/contract.json');
    expect(error.why).toContain(storageHash);
    expect(error.meta).toMatchObject({
      storageHash,
      computedHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      jsonPath: '/store/contract.json',
    });
    expect(error.meta?.['computedHash']).not.toBe(storageHash);
  });

  it('recomputes each hash once per verifier instance', () => {
    let hookCalls = 0;
    const hooks = {
      shouldPreserveEmpty: () => {
        hookCalls += 1;
        return false;
      },
    };
    const storage = { namespaces: { a: { entries: {} } } };
    const storageHash = computeStorageHash({
      target: TARGET,
      targetFamily: TARGET_FAMILY,
      storage,
      ...hooks,
    });
    const contractJson = {
      storage: { ...storage, storageHash },
      target: TARGET,
      targetFamily: TARGET_FAMILY,
    };

    const verifier = createSnapshotContentVerifier(hooks);
    verifier.assertSnapshotContentMatches(contractJson, storageHash, 'p');
    const callsAfterFirst = hookCalls;
    verifier.assertSnapshotContentMatches(contractJson, storageHash, 'p');

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(hookCalls).toBe(callsAfterFirst);
  });
});

describe('readContractSnapshotJson content verification', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'contract-snapshot-verify-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns an untampered snapshot when a verifier is supplied', async () => {
    const { contractJson, storageHash } = genuineContract({ namespaces: {} });
    await writeContractSnapshot(migrationsDir, storageHash, {
      contractJson,
      contractDts: 'export type Contract = {};',
    });

    const read = await readContractSnapshotJson(
      migrationsDir,
      storageHash,
      createSnapshotContentVerifier(),
    );

    expect(read).toEqual(contractJson);
  });

  it('rejects a snapshot whose content was edited under an unchanged hash field', async () => {
    const { contractJson, storageHash } = genuineContract({ namespaces: {} });
    await writeContractSnapshot(migrationsDir, storageHash, {
      contractJson,
      contractDts: 'export type Contract = {};',
    });
    const jsonPath = join(contractSnapshotDir(migrationsDir, storageHash), 'contract.json');
    const tampered = {
      ...contractJson,
      storage: { ...contractJson.storage, namespaces: { sneaky: { entries: {} } } },
    };
    await writeFile(jsonPath, JSON.stringify(tampered), 'utf-8');

    await expect(
      readContractSnapshotJson(migrationsDir, storageHash, createSnapshotContentVerifier()),
    ).rejects.toMatchObject({ code: 'MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH' });
  });

  it('tolerant read resolves a tampered snapshot to undefined instead of returning it', async () => {
    const { contractJson, storageHash } = genuineContract({ namespaces: {} });
    await writeContractSnapshot(migrationsDir, storageHash, {
      contractJson,
      contractDts: 'export type Contract = {};',
    });
    const jsonPath = join(contractSnapshotDir(migrationsDir, storageHash), 'contract.json');
    const tampered = {
      ...contractJson,
      storage: { ...contractJson.storage, namespaces: { sneaky: { entries: {} } } },
    };
    await writeFile(jsonPath, JSON.stringify(tampered), 'utf-8');

    await expect(
      readContractSnapshotJsonTolerant(migrationsDir, storageHash, createSnapshotContentVerifier()),
    ).resolves.toBeUndefined();
    await expect(readContractSnapshotJsonTolerant(migrationsDir, storageHash)).resolves.toEqual(
      tampered,
    );
  });

  it('reads without verification when no verifier is supplied', async () => {
    const { contractJson, storageHash } = genuineContract({ namespaces: {} });
    await writeContractSnapshot(migrationsDir, storageHash, {
      contractJson,
      contractDts: 'export type Contract = {};',
    });
    const jsonPath = join(contractSnapshotDir(migrationsDir, storageHash), 'contract.json');
    const tampered = {
      ...contractJson,
      storage: { ...contractJson.storage, namespaces: { x: 1 } },
    };
    await writeFile(jsonPath, JSON.stringify(tampered), 'utf-8');

    await expect(readContractSnapshotJson(migrationsDir, storageHash)).resolves.toEqual(tampered);
  });
});
