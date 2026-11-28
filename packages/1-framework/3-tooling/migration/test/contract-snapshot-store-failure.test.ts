import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  writeFileFailOnCall: null as number | null,
  writeFileCount: 0,
  renameFailOnCall: null as number | null,
  renameCount: 0,
  renameErrorCode: null as string | null,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (path: string, content: string) => {
      fsMocks.writeFileCount += 1;
      if (fsMocks.writeFileFailOnCall === fsMocks.writeFileCount) {
        throw new Error(`simulated writeFile failure on call ${fsMocks.writeFileCount}`);
      }
      return actual.writeFile(path, content);
    },
    rename: async (src: string, dest: string) => {
      fsMocks.renameCount += 1;
      if (fsMocks.renameFailOnCall === fsMocks.renameCount) {
        const error = new Error(
          `simulated rename failure on call ${fsMocks.renameCount}`,
        ) as Error & {
          code?: string;
        };
        if (fsMocks.renameErrorCode !== null) {
          error.code = fsMocks.renameErrorCode;
        }
        throw error;
      }
      return actual.rename(src, dest);
    },
  };
});

afterAll(() => {
  vi.doUnmock('node:fs/promises');
});

import { mkdtemp, rm } from 'node:fs/promises';
import { CONTRACT_SNAPSHOTS_DIRNAME } from '@internal/framework-components/control';
import { contractSnapshotDir, writeContractSnapshot } from '../src/contract-snapshot-store';

const STORAGE_HASH = 'a'.repeat(64);

function contractFixture(storageHash: string) {
  return { formatVersion: 1, storage: { storageHash }, target: 'postgres' };
}

describe('writeContractSnapshot atomic-write failure handling', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    fsMocks.writeFileFailOnCall = null;
    fsMocks.writeFileCount = 0;
    fsMocks.renameFailOnCall = null;
    fsMocks.renameCount = 0;
    fsMocks.renameErrorCode = null;
    migrationsDir = await mkdtemp(join(tmpdir(), 'contract-snapshot-store-failure-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('leaves no partial entry when the contract.d.ts write fails after contract.json was written', async () => {
    fsMocks.writeFileFailOnCall = 2;

    await expect(
      writeContractSnapshot(migrationsDir, STORAGE_HASH, {
        contractJson: contractFixture(STORAGE_HASH),
        contractDts: 'export type Contract = {};',
      }),
    ).rejects.toThrow('simulated writeFile failure on call 2');

    expect(existsSync(contractSnapshotDir(migrationsDir, STORAGE_HASH))).toBe(false);
    expect(readdirSync(join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME))).toEqual([]);
  });

  it('leaves no partial entry when the contract.json write fails', async () => {
    fsMocks.writeFileFailOnCall = 1;

    await expect(
      writeContractSnapshot(migrationsDir, STORAGE_HASH, {
        contractJson: contractFixture(STORAGE_HASH),
        contractDts: 'export type Contract = {};',
      }),
    ).rejects.toThrow('simulated writeFile failure on call 1');

    expect(existsSync(contractSnapshotDir(migrationsDir, STORAGE_HASH))).toBe(false);
    expect(readdirSync(join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME))).toEqual([]);
  });

  it('leaves no partial entry when the final rename fails for a non-race reason', async () => {
    fsMocks.renameFailOnCall = 1;
    fsMocks.renameErrorCode = 'EACCES';

    await expect(
      writeContractSnapshot(migrationsDir, STORAGE_HASH, {
        contractJson: contractFixture(STORAGE_HASH),
        contractDts: 'export type Contract = {};',
      }),
    ).rejects.toThrow('simulated rename failure on call 1');

    expect(existsSync(contractSnapshotDir(migrationsDir, STORAGE_HASH))).toBe(false);
    expect(readdirSync(join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME))).toEqual([]);
  });

  it.each(['EEXIST', 'ENOTEMPTY'])(
    'treats a race-losing rename (%s) as write-if-absent success and cleans up the temp dir',
    async (code) => {
      fsMocks.renameFailOnCall = 1;
      fsMocks.renameErrorCode = code;

      const result = await writeContractSnapshot(migrationsDir, STORAGE_HASH, {
        contractJson: contractFixture(STORAGE_HASH),
        contractDts: 'export type Contract = {};',
      });

      expect(result).toEqual({
        written: false,
        dir: contractSnapshotDir(migrationsDir, STORAGE_HASH),
      });
      expect(readdirSync(join(migrationsDir, CONTRACT_SNAPSHOTS_DIRNAME))).toEqual([]);
    },
  );
});
