import { mkdir, writeFile } from 'node:fs/promises';
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
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

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
    `test-migration-apply-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

// These tests write migration packages to disk, attest them (SHA-256 + read/write),
// then read them back. The shared default timeout is intentionally overridden here
// because this test does real filesystem work and still needs more headroom.
// filesystem I/O on slow CI runners.
describe('migrate — pending migration resolution', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('finds pending path from empty marker to leaf', async () => {
    const tempDir = await createTempDir('pending-empty');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: 'hash-a',
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'initial',
    });

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);

    const markerHash = EMPTY_CONTRACT_HASH;
    const path = findPath(graph, markerHash, 'hash-a');

    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(EMPTY_CONTRACT_HASH);
    expect(path![0]!.to).toBe('hash-a');
  });

  it('finds pending path for multi-step migration', async () => {
    const tempDir = await createTempDir('pending-multi');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: 'hash-a',
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });

    await writeAttestedMigration(migrationsDir, {
      from: 'hash-a',
      to: 'hash-b',
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);

    const path = findPath(graph, 'hash-a', 'hash-b');
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe('hash-a');
    expect(path![0]!.to).toBe('hash-b');

    const fullPath = findPath(graph, EMPTY_CONTRACT_HASH, 'hash-b');
    expect(fullPath).toHaveLength(2);
    expect(fullPath![0]!.to).toBe('hash-a');
    expect(fullPath![1]!.to).toBe('hash-b');
  });

  it('finds path to an explicit destination hash', async () => {
    const tempDir = await createTempDir('explicit-destination');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: 'hash-a',
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });

    await writeAttestedMigration(migrationsDir, {
      from: 'hash-a',
      to: 'hash-b',
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);

    const pathToContractA = findPath(graph, EMPTY_CONTRACT_HASH, 'hash-a');
    expect(pathToContractA).toHaveLength(1);
    expect(pathToContractA![0]!.to).toBe('hash-a');
  });

  it('returns empty path when marker already at leaf', async () => {
    const tempDir = await createTempDir('at-leaf');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: 'hash-a',
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'initial',
    });

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);

    const path = findPath(graph, 'hash-a', 'hash-a');
    expect(path).toHaveLength(0);
  });

  it('returns null when marker hash is not in migration chain', async () => {
    const tempDir = await createTempDir('unknown-marker');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: 'hash-a',
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'initial',
    });

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);

    const path = findPath(graph, 'unknown-hash', 'hash-a');
    expect(path).toBeNull();
  });

  it('surfaces migration.json with `migrationHash: null` as a load problem', async () => {
    // The arktype schema in `io.ts` requires `migrationHash` to be a
    // string; a null value (or any non-string) must surface as a
    // `packageUnloadable` problem from the tolerant `readMigrationsDir`
    // (the invalid directory is omitted from `packages` but recorded in
    // `problems`) rather than being silently skipped, so users know
    // which directory to re-emit.
    const tempDir = await createTempDir('reject-invalid-hash');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: 'hash-a',
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'initial',
    });

    const invalidDir = join(
      migrationsDir,
      formatMigrationDirName(new Date(2026, 0, 2), 'invalid-hash'),
    );
    const baseMetadata = {
      from: 'hash-a',
      to: EMPTY_CONTRACT_HASH,
      providedInvariants: [],
      createdAt: new Date().toISOString(),
    };
    const invalidJson = JSON.stringify({ ...baseMetadata, migrationHash: null });
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'migration.json'), invalidJson);
    await writeFile(join(invalidDir, 'ops.json'), '[]');

    const { packages, problems } = await readMigrationsDir(migrationsDir, { migrationsDir });
    expect(packages).toHaveLength(1);
    expect(problems).toContainEqual(
      expect.objectContaining({
        kind: 'packageUnloadable',
        dirName: formatMigrationDirName(new Date(2026, 0, 2), 'invalid-hash'),
      }),
    );
  });

  it('distinguishes corrupted empty-sentinel marker from absent marker', async () => {
    const tempDir = await createTempDir('empty-sentinel-marker');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: null,
      to: 'hash-a',
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'initial',
    });

    await writeAttestedMigration(migrationsDir, {
      from: 'hash-a',
      to: 'hash-b',
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);

    const corruptedMarkerHash = EMPTY_CONTRACT_HASH;
    const path = findPath(graph, corruptedMarkerHash, 'hash-b');
    expect(path).toHaveLength(2);
  });

  it('resolves correct package for each edge in path', async () => {
    const tempDir = await createTempDir('edge-packages');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const m1 = await writeAttestedMigration(migrationsDir, {
      from: null,
      to: 'hash-a',
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'first',
    });

    const m2 = await writeAttestedMigration(migrationsDir, {
      from: 'hash-a',
      to: 'hash-b',
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'second',
    });

    const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
    const attested = packages;
    const graph = reconstructGraph(attested);
    const path = findPath(graph, EMPTY_CONTRACT_HASH, 'hash-b')!;

    expect(path).toHaveLength(2);

    for (const migration of path) {
      const pkg = attested.find((p) => p.dirName === migration.dirName);
      expect(pkg).toBeDefined();
      // The graph edge translates baseline `null` → EMPTY_CONTRACT_HASH;
      // the manifest still carries `null`, so bridge here for comparison.
      expect(pkg!.metadata.from ?? EMPTY_CONTRACT_HASH).toBe(migration.from);
      expect(pkg!.metadata.to).toBe(migration.to);
    }

    expect(path[0]!.dirName).toBe(m1.dirName);
    expect(path[1]!.dirName).toBe(m2.dirName);
  });
});
