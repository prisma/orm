/**
 * Checks the fixtures against the framework this release ships: their hashes recompute, the
 * contract this release emits loads, and the one the previous release emitted is refused. These
 * tests call live framework code, so they hold only while the fragment is pending.
 */
import { readFileSync } from 'node:fs';
import { computeStorageHash } from '@internal/contract/hashing';
import sql from '@internal/family-sql/control';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { sqliteStack } from '../../date-time-defaults/sqlite-authoring';
import { fixtures, NEW_HASH, OLD_HASH } from './test-helpers';

const family = sql.create(sqliteStack);

function read(side: 'before' | 'after', path: string) {
  return JSON.parse(readFileSync(join(fixtures, 'sqlite-project', side, path), 'utf8'));
}

function recomputed(contract: {
  target: string;
  targetFamily: string;
  storage: Record<string, unknown>;
}) {
  const { storageHash: _stored, ...storage } = contract.storage;
  return computeStorageHash({
    target: contract.target,
    targetFamily: contract.targetFamily,
    storage,
    ...sqlContractCanonicalizationHooks,
  });
}

describe.each([
  ['before', OLD_HASH],
  ['after', NEW_HASH],
] as const)('the %s side of the fixture', (side, hash) => {
  it('stores hashes the framework recomputes', () => {
    const contract = read(side, 'src/prisma/contract.json');
    const snapshot = read(side, `migrations/snapshots/${hash}/contract.json`);
    const metadata = read(side, 'migrations/app/20260101T0000_initial/migration.json');
    const ops = read(side, 'migrations/app/20260101T0000_initial/ops.json');
    expect({
      contract: recomputed(contract),
      snapshot: recomputed(snapshot),
      migration: computeMigrationHash(metadata, ops),
    }).toEqual({ contract: hash, snapshot: hash, migration: metadata.migrationHash });
  });
});

describe('loading the fixture with this release', () => {
  it('accepts the contract this release emits', () => {
    expect(() =>
      family.deserializeContract(read('after', 'src/prisma/contract.json')),
    ).not.toThrow();
  });

  it('refuses the contract the previous release emitted', () => {
    expect(() => family.deserializeContract(read('before', 'src/prisma/contract.json'))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.VALIDATION_FAILED',
        message: expect.stringContaining(
          'columns.at: codec sqlite/datetime@1 represents sqlite/datetime, not sqlite/text',
        ),
      }),
    );
  });
});
