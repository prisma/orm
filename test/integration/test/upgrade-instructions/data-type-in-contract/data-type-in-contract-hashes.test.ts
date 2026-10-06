import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSnapshotContentVerifier } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { basename, dirname, join, relative } from 'pathe';
import { describe, expect, it } from 'vitest';

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const verifier = createSnapshotContentVerifier(sqlContractCanonicalizationHooks);

function afterFiles(): string[] {
  return readdirSync(fixturesRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => relative(fixturesRoot, path).split('/')[1] === 'after');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function storedStorageHash(path: string, contract: Record<string, unknown>): string {
  if (basename(dirname(dirname(path))) === 'snapshots') return basename(dirname(path));
  const storage = contract['storage'];
  return typeof storage === 'object' && storage !== null && 'storageHash' in storage
    ? String(storage.storageHash)
    : '';
}

describe('the data-type-in-contract upgrade fixtures', () => {
  const files = afterFiles();
  const contracts = files
    .filter((path) => path.endsWith('.json'))
    .map((path) => ({ path, json: readJson(path) }))
    .filter(({ json }) => json['targetFamily'] === 'sql');
  const migrations = files.filter((path) => basename(path) === 'migration.json');

  it('hold SQL contracts and migrations to check', () => {
    expect({ contracts: contracts.length > 0, migrations: migrations.length > 0 }).toEqual({
      contracts: true,
      migrations: true,
    });
  });

  it('store the storage hash the framework computes for each upgraded contract', () => {
    for (const { path, json } of contracts) {
      expect(() =>
        verifier.assertSnapshotContentMatches(json, storedStorageHash(path, json), path),
      ).not.toThrow();
    }
  });

  it('store the migration hash the framework computes for each rewritten migration', () => {
    const mismatches = migrations.flatMap((path) => {
      const metadata = readJson(path);
      const ops = JSON.parse(readFileSync(join(dirname(path), 'ops.json'), 'utf8'));
      return computeMigrationHash(metadata as Parameters<typeof computeMigrationHash>[0], ops) ===
        metadata['migrationHash']
        ? []
        : [relative(fixturesRoot, path)];
    });
    expect(mismatches).toEqual([]);
  });
});
