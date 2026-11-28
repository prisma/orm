/**
 * Regression guard: the shipped demo migrations must pass offline integrity
 * checks. This test would have caught the no-op bookend bug (commit
 * bd31bc3be~1) where `from === to` collapsed two migrations into self-edges.
 *
 * Offline-only: reads migrations/ from disk + contract.json, no DB, no PGlite.
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadContractSpaceAggregate } from '@prisma/orm-postgres/migration-tools/aggregate';
import { computeMigrationHash } from '@prisma/orm-postgres/migration-tools/hash';
import { writeMigrationPackage } from '@prisma/orm-postgres/migration-tools/io';
import { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import type { Contract } from '../src/prisma/contract';

const DEMO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = join(DEMO_ROOT, 'migrations');
const CONTRACT_JSON_PATH = join(DEMO_ROOT, 'src', 'prisma', 'contract.json');

const serializer = new PostgresContractSerializer();

// Callback for loadContractSpaceAggregate: deserializes arbitrary migration
// start/end contracts, so it stays untyped (no single literal contract type).
function deserializeContract(raw: unknown) {
  return serializer.deserializeContract(raw);
}

async function loadAppContract() {
  const { default: contractJson } = await import(CONTRACT_JSON_PATH, { with: { type: 'json' } });
  return serializer.deserializeContract<Contract>(contractJson);
}

const PGVECTOR_EXTENSION: { readonly id: string; readonly targetId: string } = {
  id: 'pgvector',
  targetId: 'postgres',
};

describe('demo migration integrity (offline)', () => {
  it(
    'shipped migrations pass aggregate integrity check',
    async () => {
      const appContract = await loadAppContract();
      const aggregate = await loadContractSpaceAggregate({
        migrationsDir: MIGRATIONS_DIR,
        deserializeContract,
        appContract,
      });

      const violations = aggregate.checkIntegrity({
        declaredExtensions: [PGVECTOR_EXTENSION],
        checkContracts: true,
      });

      expect(violations).toEqual([]);
    },
    timeouts.databaseOperation,
  );
});

describe('demo migration integrity — guard verification', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it(
    'detects a no-op self-edge migration (sameSourceAndTarget)',
    async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'demo-integrity-proof-'));

      // Copy the real migrations dir into tmpDir so we only mutate a copy.
      const tmpMigrationsDir = join(tmpDir, 'migrations');
      await cp(MIGRATIONS_DIR, tmpMigrationsDir, { recursive: true });

      // Inject a no-op migration: from === to.
      const selfEdgeHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const baseMetadata = {
        from: selfEdgeHash,
        to: selfEdgeHash,
        providedInvariants: [] as string[],
        createdAt: '2026-06-09T00:00:00.000Z',
      };
      const noopMigration = {
        ...baseMetadata,
        migrationHash: computeMigrationHash(baseMetadata, []),
      };
      await writeMigrationPackage(
        join(tmpMigrationsDir, 'app', '20260609T0000_noop_selfedge'),
        noopMigration,
        [],
      );

      const appContract = await loadAppContract();
      const aggregate = await loadContractSpaceAggregate({
        migrationsDir: tmpMigrationsDir,
        deserializeContract,
        appContract,
      });

      const violations = aggregate.checkIntegrity({
        declaredExtensions: [PGVECTOR_EXTENSION],
        checkContracts: true,
      });

      const selfEdgeViolations = violations.filter((v) => v.kind === 'sameSourceAndTarget');
      expect(selfEdgeViolations).toHaveLength(1);
      expect(selfEdgeViolations[0]).toMatchObject({
        kind: 'sameSourceAndTarget',
        spaceId: 'app',
        dirName: '20260609T0000_noop_selfedge',
      });
    },
    timeouts.databaseOperation,
  );
});
