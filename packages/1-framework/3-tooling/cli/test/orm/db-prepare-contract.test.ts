import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readContractDocument } from '../../src/orm/db/prepare';

describe('readContractDocument, which db init and db update read the contract with', () => {
  let dir: string;
  let contractPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'db-prepare-contract-'));
    contractPath = join(dir, 'contract.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeContract(version: Record<string, unknown>): Promise<void> {
    await writeFile(
      contractPath,
      JSON.stringify({ ...version, target: 'postgres', storage: { storageHash: 'h' } }),
    );
  }

  it('reads a contract in a format version it knows', async () => {
    await writeContract({ formatVersion: 1 });
    const read = await readContractDocument(contractPath);
    expect(read).toMatchObject({ ok: true, value: { formatVersion: 1, target: 'postgres' } });
  });

  it.each([
    ['with no version field', {}, 'CONTRACT.FORMAT_VERSION_MISSING'],
    ['a pre-release wrote', { schemaVersion: '1' }, 'CONTRACT.FORMAT_VERSION_MISSING'],
    ['a newer release wrote', { formatVersion: 2 }, 'CONTRACT.FORMAT_VERSION_NEWER'],
  ])('refuses a contract %s, naming the file', async (_, version, code) => {
    await writeContract(version);
    const read = await readContractDocument(contractPath);
    expect(read).toMatchObject({
      ok: false,
      failure: { code, where: { path: contractPath } },
    });
    expect(read.ok ? '' : read.failure.message).toContain(contractPath);
  });
});
