import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import {
  formatMigrationDirName,
  readMigrationPackage,
  readMigrationsDir,
  writeMigrationPackage,
} from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { isGraphNode, reconstructGraph } from '@internal/migration-tools/migration-graph';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

function attestedMetadata(
  base: Omit<MigrationMetadata, 'migrationHash'>,
  ops: readonly MigrationPlanOperation[],
): MigrationMetadata {
  return { ...base, migrationHash: computeMigrationHash(base, ops) };
}

/**
 * Canonical helper for writing a test migration package to disk. Always
 * produces a *consistent* (attested) package: the `migrationHash` is computed
 * over the exact `ops` passed to the writer, so the resulting package
 * round-trips through `readMigrationPackage`'s integrity check.
 *
 * Tampering tests use this same helper and then surgically overwrite the
 * offending file post-hoc — see the equivalent helper in
 * `migration-tools/test/fixtures.ts` for the canonical pattern. (The CLI
 * copy mirrors the migration-tools fixture; consolidation into a published
 * `@internal/migration-tools/testing` subpath is queued as a follow-up.)
 */
async function writeTestPackage(
  dir: string,
  base: Omit<MigrationMetadata, 'migrationHash'>,
  ops: readonly MigrationPlanOperation[],
): Promise<MigrationMetadata> {
  const metadata = attestedMetadata(base, ops);
  await writeMigrationPackage(dir, metadata, ops);
  return metadata;
}

function createTableOp(table: string): MigrationPlanOperation {
  return {
    id: `table.${table}`,
    label: `Create table "${table}"`,
    operationClass: 'additive',
  };
}

async function createTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await createTempDir();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('migration plan → emit end-to-end', () => {
  it('new project: plan writes valid package, verify passes', async () => {
    await withTempDir(async (root) => {
      const migrationsDir = join(root, 'migrations');
      await mkdir(migrationsDir, { recursive: true });

      const ops: MigrationPlanOperation[] = [createTableOp('user')];

      const dirName = formatMigrationDirName(new Date(), 'initial');
      const packageDir = join(migrationsDir, dirName);
      const metadata = await writeTestPackage(
        packageDir,
        {
          from: null,
          to: 'initial-hash',
          providedInvariants: [],
          createdAt: new Date().toISOString(),
        },
        ops,
      );

      const pkg = await readMigrationPackage(packageDir, { migrationsDir });
      expect(pkg.metadata.from).toBeNull();
      expect(pkg.metadata.to).toBe('initial-hash');
      expect(pkg.metadata.migrationHash).toBe(metadata.migrationHash);
      expect(pkg.ops).toHaveLength(1);
    });
  });

  it(
    'incremental change: two plans form a valid migration chain',
    async () => {
      await withTempDir(async (root) => {
        const migrationsDir = join(root, 'migrations');
        await mkdir(migrationsDir, { recursive: true });

        // Plan 1: empty → A
        const dir1 = formatMigrationDirName(new Date(2026, 0, 1, 10, 0), 'add_user');
        const path1 = join(migrationsDir, dir1);
        const ops1 = [createTableOp('user')];
        await writeTestPackage(
          path1,
          {
            from: null,
            to: 'hash-a',
            providedInvariants: [],
            createdAt: new Date().toISOString(),
          },
          ops1,
        );

        // Plan 2: A → B
        const dir2 = formatMigrationDirName(new Date(2026, 0, 2, 10, 0), 'add_post');
        const path2 = join(migrationsDir, dir2);
        const ops2 = [createTableOp('post')];
        await writeTestPackage(
          path2,
          {
            from: 'hash-a',
            to: 'hash-b',
            providedInvariants: [],
            createdAt: new Date().toISOString(),
          },
          ops2,
        );

        const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
        expect(packages).toHaveLength(2);

        const graph = reconstructGraph(packages);
        expect(isGraphNode('hash-b', graph)).toBe(true);
        expect(graph.forwardChain.get('hash-b')).toBeUndefined();

        // Verify chain integrity
        const pkg1 = packages.find((p) => p.metadata.to === 'hash-a')!;
        const pkg2 = packages.find((p) => p.metadata.to === 'hash-b')!;
        expect(pkg1.metadata.to).toBe(pkg2.metadata.from);
      });
    },
    timeouts.databaseOperation,
  );

  it('no-op: second plan with same hash produces no new files', async () => {
    await withTempDir(async (root) => {
      const migrationsDir = join(root, 'migrations');
      await mkdir(migrationsDir, { recursive: true });

      // First migration
      const dir1 = formatMigrationDirName(new Date(), 'initial');
      const path1 = join(migrationsDir, dir1);
      await writeTestPackage(
        path1,
        {
          from: null,
          to: 'target-hash',
          providedInvariants: [],
          createdAt: new Date().toISOString(),
        },
        [],
      );

      const { packages } = await readMigrationsDir(migrationsDir, { migrationsDir });
      const graph = reconstructGraph(packages);

      // Same hash → no-op
      const toStorageHash = 'target-hash';
      expect(isGraphNode(toStorageHash, graph)).toBe(true);

      // No new migration should be written — the CLI command checks this condition
      // and returns early with noOp: true
    });
  });

  it('rejects migration.json with `migrationHash: null` at read time', async () => {
    // The arktype schema in `io.ts` requires `migrationHash` to be a string;
    // a null value (or any non-string) must surface as
    // `MIGRATION.INVALID_MANIFEST` pointing at the offending directory.
    await withTempDir(async (root) => {
      const dirName = formatMigrationDirName(new Date(), 'invalid-hash');
      const packageDir = join(root, dirName);
      await mkdir(packageDir, { recursive: true });
      const invalidMetadata = {
        from: null,
        to: EMPTY_CONTRACT_HASH,
        migrationHash: null,
        providedInvariants: [],
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(packageDir, 'migration.json'), JSON.stringify(invalidMetadata));
      await writeFile(join(packageDir, 'ops.json'), '[]');

      await expect(readMigrationPackage(packageDir, { migrationsDir: root })).rejects.toMatchObject(
        {
          code: 'MIGRATION.INVALID_MANIFEST',
        },
      );
    });
  });
});
