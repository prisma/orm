import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readContractEnvelope } from '../../src/utils/command-helpers';

const STORAGE_HASH = 'f'.repeat(64);

describe('readContractEnvelope', () => {
  let dir: string;
  let contractPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'read-contract-envelope-'));
    contractPath = join(dir, 'contract.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeContract(version: Record<string, unknown>): Promise<void> {
    await writeFile(
      contractPath,
      JSON.stringify({
        ...version,
        target: 'postgres',
        targetFamily: 'sql',
        storage: { storageHash: STORAGE_HASH },
      }),
    );
  }

  it('reads the envelope of a contract in a format version it knows', async () => {
    await writeContract({ formatVersion: 1 });
    expect(await readContractEnvelope({ contract: { output: contractPath } })).toMatchObject({
      formatVersion: 1,
      storageHash: STORAGE_HASH,
      target: 'postgres',
      targetFamily: 'sql',
    });
  });

  it('refuses a contract written by a newer release, naming the file', async () => {
    await writeContract({ formatVersion: 2 });
    await expect(
      readContractEnvelope({ contract: { output: contractPath } }),
    ).rejects.toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_NEWER',
      where: { path: contractPath },
    });
  });

  it('reads a contract a release candidate wrote, in the newest format version', async () => {
    await writeContract({ schemaVersion: '1' });
    expect(await readContractEnvelope({ contract: { output: contractPath } })).toEqual({
      formatVersion: 1,
      storageHash: STORAGE_HASH,
      target: 'postgres',
      targetFamily: 'sql',
      storage: { storageHash: STORAGE_HASH },
    });
  });

  it('refuses a contract with no version field', async () => {
    await writeContract({});
    await expect(
      readContractEnvelope({ contract: { output: contractPath } }),
    ).rejects.toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
    });
  });
});
