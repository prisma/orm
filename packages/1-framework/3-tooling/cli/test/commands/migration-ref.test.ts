import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { findPath, reconstructGraph } from '@internal/migration-tools/migration-graph';
import type { RefEntry } from '@internal/migration-tools/refs';
import { readRef, writeRef } from '@internal/migration-tools/refs';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const HASH_C = `${'c'.repeat(64)}`;

const ENTRY_A: RefEntry = { hash: HASH_A, invariants: [] };
const ENTRY_B: RefEntry = { hash: HASH_B, invariants: [] };
const ENTRY_C: RefEntry = { hash: HASH_C, invariants: [] };

function createTableOp(table: string): MigrationPlanOperation {
  return {
    id: `table.${table}`,
    label: `Create table "${table}"`,
    operationClass: 'additive',
  };
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-ref-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeAttestedMigration(
  migrationsDir: string,
  opts: {
    from: string | null;
    to: string;
    ops: MigrationPlanOperation[];
    timestamp: Date;
    slug: string;
  },
): Promise<{ dirName: string; migrationHash: string }> {
  const dirName = formatMigrationDirName(opts.timestamp, opts.slug);
  const packageDir = join(migrationsDir, dirName);
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
    from: opts.from,
    to: opts.to,
    providedInvariants: [],
    createdAt: opts.timestamp.toISOString(),
  };
  const migrationHash = computeMigrationHash(baseMetadata, opts.ops);
  const metadata: MigrationMetadata = { ...baseMetadata, migrationHash };
  await writeMigrationPackage(packageDir, metadata, opts.ops);
  return { dirName, migrationHash };
}

describe('ref-aware pathfinding integration', { timeout: timeouts.databaseOperation }, () => {
  it('resolves ref to target hash for pathfinding', async () => {
    const tempDir = await createTempDir('ref-pathfind');
    const migrationsDir = join(tempDir, 'migrations');
    const refsDir = join(migrationsDir, 'refs');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: HASH_A,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });

    await writeAttestedMigration(migrationsDir, {
      from: HASH_A,
      to: HASH_B,
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    await writeAttestedMigration(migrationsDir, {
      from: HASH_B,
      to: HASH_C,
      ops: [createTableOp('comment')],
      timestamp: new Date(2026, 0, 3, 10, 0),
      slug: 'add_comment',
    });

    await writeRef(refsDir, 'staging', ENTRY_C);
    await writeRef(refsDir, 'production', ENTRY_B);

    const stagingEntry = await readRef(refsDir, 'staging');
    const productionEntry = await readRef(refsDir, 'production');

    expect(stagingEntry.hash).toBe(HASH_C);
    expect(productionEntry.hash).toBe(HASH_B);

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);

    const pathToStaging = findPath(graph, EMPTY_CONTRACT_HASH, stagingEntry.hash);
    expect(pathToStaging).toHaveLength(3);

    const pathToProduction = findPath(graph, EMPTY_CONTRACT_HASH, productionEntry.hash);
    expect(pathToProduction).toHaveLength(2);

    const pathStagingFromProd = findPath(graph, productionEntry.hash, stagingEntry.hash);
    expect(pathStagingFromProd).toHaveLength(1);
  });

  it('marker ahead of ref target produces no forward path', async () => {
    const tempDir = await createTempDir('ref-ahead');
    const migrationsDir = join(tempDir, 'migrations');
    const refsDir = join(migrationsDir, 'refs');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: HASH_A,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });

    await writeAttestedMigration(migrationsDir, {
      from: HASH_A,
      to: HASH_B,
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    await writeRef(refsDir, 'production', ENTRY_A);

    const entry = await readRef(refsDir, 'production');

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);

    const markerHash = HASH_B;
    const forwardPath = findPath(graph, markerHash, entry.hash);
    expect(forwardPath).toBeNull();

    const reversePath = findPath(graph, entry.hash, markerHash);
    expect(reversePath).toHaveLength(1);
  });
});
