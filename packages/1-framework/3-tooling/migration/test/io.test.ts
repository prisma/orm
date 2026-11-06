import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contractSnapshotDir, writeContractSnapshot } from '../src/contract-snapshot-store';
import { MigrationToolsError } from '../src/errors';
import {
  copyFilesWithRename,
  formatMigrationDirName,
  readMigrationPackage,
  readMigrationsDir,
  writeMigrationPackage,
} from '../src/io';
import { createTestMetadata, createTestOps, writeTestPackage } from './fixtures';

function expectMigrationError(error: unknown, code: string) {
  expect(MigrationToolsError.is(error)).toBe(true);
  const mte = error as MigrationToolsError;
  expect(mte.code).toBe(code);
  expect(mte.category).toBe('MIGRATION');
  expect(mte.why).toBeTruthy();
  expect(mte.fix).toBeTruthy();
}

/**
 * Write a contract snapshot store entry for `storageHash`, returning the
 * exact JSON value stored (the `storage.storageHash` field the store
 * requires, merged with `extra`).
 */
async function writeEndContractSnapshot(
  migrationsDir: string,
  storageHash: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const contractJson = { ...extra, storage: { storageHash } };
  await writeContractSnapshot(migrationsDir, storageHash, {
    contractJson,
    contractDts: 'export type Contract = unknown;\n',
  });
  return contractJson;
}

describe('writeMigrationPackage + readMigrationPackage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-io-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('round-trips metadata and ops', async () => {
    const dir = join(tmpDir, '20260225T1430_add_users');
    const { metadata, ops } = await writeTestPackage(dir);

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });

    expect(JSON.stringify(pkg.metadata)).toBe(JSON.stringify(metadata));
    expect(JSON.stringify(pkg.ops)).toBe(JSON.stringify(ops));
    expect(pkg.dirName).toBe('20260225T1430_add_users');
    expect(pkg.dirPath).toBe(dir);
  });

  it('normalizes dirPath to absolute when called with a relative path', async () => {
    const absoluteDir = join(tmpDir, '20260225T1430_add_users');
    await writeTestPackage(absoluteDir);
    const relativeDir = relative(process.cwd(), absoluteDir);

    expect(relativeDir.startsWith('/')).toBe(false);

    const pkg = await readMigrationPackage(relativeDir, { migrationsDir: tmpDir });

    expect(pkg.dirPath).toBe(absoluteDir);
  });

  it('reads the end contract snapshot from the store, keyed by metadata.to', async () => {
    const dir = join(tmpDir, '20260225T1430_snapshots');
    const toHash = 'e'.repeat(64);
    const { metadata } = await writeTestPackage(dir, { to: toHash });
    const endJson = await writeEndContractSnapshot(tmpDir, metadata.to, { marker: 'end' });

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });

    expect(pkg.endContractJson).toEqual(endJson);
  });

  it('reads only the store entry keyed by metadata.to, not the from-hash entry', async () => {
    // The edge's before-state is the predecessor's end snapshot by chain
    // construction, so the loader never surfaces the from-hash's entry.
    const dir = join(tmpDir, '20260225T1430_start_ignored');
    const fromHash = '5'.repeat(64);
    const toHash = '6'.repeat(64);
    const { metadata } = await writeTestPackage(dir, { from: fromHash, to: toHash });
    await writeEndContractSnapshot(tmpDir, fromHash, { marker: 'start' });
    const endJson = await writeEndContractSnapshot(tmpDir, metadata.to, { marker: 'end' });

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });

    expect(pkg.endContractJson).toEqual(endJson);
    expect('startContractJson' in pkg).toBe(false);
  });

  it('omits endContractJson when no store entry exists', async () => {
    const dir = join(tmpDir, '20260225T1430_bare');
    await writeTestPackage(dir);

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });

    expect(pkg.endContractJson).toBeUndefined();
    expect('endContractJson' in pkg).toBe(false);
  });

  it('treats a malformed end snapshot as absent instead of failing the load', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_snapshot');
    const toHash = '7'.repeat(64);
    const { metadata } = await writeTestPackage(dir, { to: toHash });
    const snapshotDir = contractSnapshotDir(tmpDir, metadata.to);
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(join(snapshotDir, 'contract.json'), 'not json');

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });

    expect(pkg.endContractJson).toBeUndefined();
  });

  it('treats a literal-null end snapshot as absent', async () => {
    // `undefined` is the single "no snapshot" sentinel downstream; a null
    // contract is not a storable state.
    const dir = join(tmpDir, '20260225T1430_null_snapshot');
    const toHash = '8'.repeat(64);
    const { metadata } = await writeTestPackage(dir, { to: toHash });
    const snapshotDir = contractSnapshotDir(tmpDir, metadata.to);
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(join(snapshotDir, 'contract.json'), 'null');

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });

    expect('endContractJson' in pkg).toBe(false);
  });

  it('writes pretty-printed JSON', async () => {
    const dir = join(tmpDir, '20260225T1430_test');
    await writeTestPackage(dir);

    const manifestJson = await readFile(join(dir, 'migration.json'), 'utf-8');
    expect(manifestJson).toContain('\n');
    expect(manifestJson).toContain('  ');
  });

  it('errors on malformed migration.json with code MIGRATION.INVALID_JSON', async () => {
    const dir = join(tmpDir, '20260225T1430_bad');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), 'not json');
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_JSON');
      return true;
    });
  });

  it('errors on missing ops.json with code MIGRATION.FILE_MISSING', async () => {
    const dir = join(tmpDir, '20260225T1430_no_ops');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(createTestMetadata()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.FILE_MISSING');
      expect((e as MigrationToolsError).meta).toHaveProperty('file', 'ops.json');
      return true;
    });
  });

  it('errors on missing migration.json with code MIGRATION.FILE_MISSING', async () => {
    const dir = join(tmpDir, '20260225T1430_no_manifest');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.FILE_MISSING');
      expect((e as MigrationToolsError).meta).toHaveProperty('file', 'migration.json');
      return true;
    });
  });

  it('errors when migration.json is missing required fields with code MIGRATION.INVALID_MANIFEST', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_manifest');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify({ from: 'x' }));
    await writeFile(join(dir, 'ops.json'), '[]');

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when migrationHash is missing from migration.json', async () => {
    const dir = join(tmpDir, '20260225T1430_no_edgeid');
    const { migrationHash: _, ...metadataWithoutHash } = createTestMetadata();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadataWithoutHash));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when migrationHash has wrong type', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_edgeid');
    const metadata = { ...createTestMetadata(), migrationHash: 123 };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadata));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when "from" is not a string or null', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_from');
    const metadata = { ...createTestMetadata(), from: 42 };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadata));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('rejects manifest carrying a `kind` field', async () => {
    const dir = join(tmpDir, '20260225T1430_carries_kind');
    const metadata = { ...createTestMetadata(), kind: 'regular' };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadata));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('rejects manifest carrying a legacy inlined `toContract` field', async () => {
    const dir = join(tmpDir, '20260225T1430_carries_to_contract');
    const metadata = {
      ...createTestMetadata({}, []),
      toContract: { storage: { storageHash: 'x' } },
    };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadata));
    await writeFile(join(dir, 'ops.json'), JSON.stringify([]));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('rejects manifest carrying a legacy inlined `fromContract` field', async () => {
    const dir = join(tmpDir, '20260225T1430_carries_from_contract');
    const metadata = { ...createTestMetadata({}, []), fromContract: null };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadata));
    await writeFile(join(dir, 'ops.json'), JSON.stringify([]));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('loads a package whose directory holds only migration.json + ops.json', async () => {
    // Runner-side independence: the migration loader must not require a
    // resolvable snapshot store entry to be present on disk. Contracts
    // are author-time conveniences, not structural inputs to the runner.
    // The stored manifest carries the
    // storage-hash bookends (`from`, `to`) which is all the runner needs
    // to walk the migration graph.
    const { readdir } = await import('node:fs/promises');
    const dir = join(tmpDir, '20260225T1430_runner_independent');
    await writeTestPackage(dir);

    expect((await readdir(dir)).sort()).toEqual(['migration.json', 'ops.json']);

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });
    expect(pkg.dirName).toBe('20260225T1430_runner_independent');
    expect(pkg.metadata.migrationHash).toBeDefined();
  });

  it('accepts `from: null` (baseline manifest)', async () => {
    const dir = join(tmpDir, '20260225T1430_baseline');
    await writeTestPackage(dir, { from: null });

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });
    expect(pkg.metadata.from).toBeNull();
  });

  it('rejects `from: ""` (legacy empty-string sentinel)', async () => {
    const dir = join(tmpDir, '20260225T1430_empty_from');
    const metadata = { ...createTestMetadata(), from: '' };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadata));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when "createdAt" is missing', async () => {
    const dir = join(tmpDir, '20260225T1430_no_created');
    const { createdAt: _, ...metadataWithout } = createTestMetadata();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadataWithout));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when ops is not an array', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_ops');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(createTestMetadata()));
    await writeFile(join(dir, 'ops.json'), JSON.stringify({ not: 'an array' }));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when ops entry is missing required fields', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_op_entry');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(createTestMetadata()));
    await writeFile(join(dir, 'ops.json'), JSON.stringify([{ id: 'x' }]));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('rejects migration.json with migrationHash: null', async () => {
    const dir = join(tmpDir, '20260225T1430_null_hash');
    const metadata = { ...createTestMetadata(), migrationHash: null };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify(metadata));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_MANIFEST');
      return true;
    });
  });

  it('errors when writing to existing directory with code MIGRATION.DIR_EXISTS', async () => {
    const dir = join(tmpDir, '20260225T1430_exists');
    await mkdir(dir, { recursive: true });

    await expect(
      writeMigrationPackage(dir, createTestMetadata(), createTestOps()),
    ).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.DIR_EXISTS');
      expect((e as MigrationToolsError).meta).toHaveProperty('dir');
      return true;
    });
  });

  it('creates missing parent directories before writing package files', async () => {
    const dir = join(tmpDir, 'nested', '20260225T1430_nested');
    await writeTestPackage(dir);

    const pkg = await readMigrationPackage(dir, { migrationsDir: tmpDir });
    expect(pkg.dirName).toBe('20260225T1430_nested');
  });

  it('rethrows non-ENOENT errors while reading migration.json', async () => {
    const dir = join(tmpDir, '20260225T1430_bad_manifest_file');
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'migration.json'));
    await writeFile(join(dir, 'ops.json'), JSON.stringify(createTestOps()));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });

  it('throws MIGRATION.HASH_MISMATCH when ops.json is tampered post-write', async () => {
    const dir = join(tmpDir, '20260225T1430_tampered_ops');
    const { metadata, ops } = await writeTestPackage(dir);

    const tamperedOps = [
      ...ops,
      { id: 'extra', label: 'Extra', operationClass: 'additive' as const },
    ];
    await writeFile(join(dir, 'ops.json'), JSON.stringify(tamperedOps, null, 2));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.HASH_MISMATCH');
      const mte = e as MigrationToolsError;
      expect(mte.meta).toMatchObject({
        dir,
        storedHash: metadata.migrationHash,
      });
      expect(mte.meta).toHaveProperty('computedHash');
      expect((mte.meta as { computedHash: string }).computedHash).not.toBe(metadata.migrationHash);
      const relativeDir = relative(process.cwd(), dir);
      expect(mte.why).toContain(relativeDir);
      expect(mte.fix).toContain(relativeDir);
      return true;
    });
  });

  it('throws MIGRATION.HASH_MISMATCH when a non-migrationHash field in migration.json is tampered', async () => {
    const dir = join(tmpDir, '20260225T1430_tampered_manifest');
    const { metadata } = await writeTestPackage(dir);

    const manifestPath = join(dir, 'migration.json');
    const content = JSON.parse(await readFile(manifestPath, 'utf-8'));
    content.createdAt = '2024-01-01T00:00:00.000Z';
    await writeFile(manifestPath, JSON.stringify(content, null, 2));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.HASH_MISMATCH');
      const mte = e as MigrationToolsError;
      expect(mte.meta).toMatchObject({
        dir,
        storedHash: metadata.migrationHash,
      });
      expect(mte.meta).toHaveProperty('computedHash');
      expect((mte.meta as { computedHash: string }).computedHash).not.toBe(metadata.migrationHash);
      const relativeDir = relative(process.cwd(), dir);
      expect(mte.why).toContain(relativeDir);
      expect(mte.fix).toContain(relativeDir);
      return true;
    });
  });

  it('throws MIGRATION.PROVIDED_INVARIANTS_MISMATCH when migration.json disagrees with ops.json', async () => {
    const dir = join(tmpDir, '20260225T1430_invariants_mismatch');
    // Build a self-consistent package whose manifest claims invariant
    // "alpha" but whose ops actually declare "alpha" — then surgically
    // overwrite the manifest's providedInvariants list with an extra,
    // unbacked id, and reset the migrationHash to a *recomputed* hash
    // over the tampered manifest so the providedInvariants check is the
    // first error we hit (otherwise HASH_MISMATCH would fire first).
    const ops = [
      ...createTestOps(),
      {
        id: 'data.alpha',
        label: 'Data: alpha',
        operationClass: 'data' as const,
        name: 'alpha',
        invariantId: 'alpha',
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];
    await writeTestPackage(dir, { providedInvariants: ['alpha'] }, ops);

    const manifestPath = join(dir, 'migration.json');
    const content = JSON.parse(await readFile(manifestPath, 'utf-8'));
    content.providedInvariants = ['alpha', 'phantom'];
    // Recompute migrationHash over the tampered manifest so the
    // PROVIDED_INVARIANTS_MISMATCH check is what surfaces, not the
    // generic hash mismatch.
    const { computeMigrationHash } = await import('../src/hash');
    content.migrationHash = computeMigrationHash(content, ops);
    await writeFile(manifestPath, JSON.stringify(content, null, 2));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.PROVIDED_INVARIANTS_MISMATCH');
      const mte = e as MigrationToolsError;
      expect(mte.meta).toMatchObject({
        stored: ['alpha', 'phantom'],
        derived: ['alpha'],
        difference: { extra: ['phantom'], missing: [] },
      });
      return true;
    });
  });

  it('PROVIDED_INVARIANTS_MISMATCH calls out ordering when stored has the same ids in a different order', async () => {
    const dir = join(tmpDir, '20260225T1430_invariants_unsorted');
    const ops = [
      ...createTestOps(),
      {
        id: 'data.alpha',
        label: 'Data: alpha',
        operationClass: 'data' as const,
        name: 'alpha',
        invariantId: 'alpha',
        source: 'migration.ts',
        check: null,
        run: null,
      },
      {
        id: 'data.zebra',
        label: 'Data: zebra',
        operationClass: 'data' as const,
        name: 'zebra',
        invariantId: 'zebra',
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];
    await writeTestPackage(dir, { providedInvariants: ['alpha', 'zebra'] }, ops);

    const manifestPath = join(dir, 'migration.json');
    const content = JSON.parse(await readFile(manifestPath, 'utf-8'));
    content.providedInvariants = ['zebra', 'alpha'];
    const { computeMigrationHash } = await import('../src/hash');
    content.migrationHash = computeMigrationHash(content, ops);
    await writeFile(manifestPath, JSON.stringify(content, null, 2));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.PROVIDED_INVARIANTS_MISMATCH');
      const mte = e as MigrationToolsError;
      expect(mte.why).toContain('different order');
      expect(mte.meta).toMatchObject({
        difference: { missing: [], extra: [] },
      });
      return true;
    });
  });

  it('throws MIGRATION.INVALID_INVARIANT_ID when ops.json carries a malformed invariantId', async () => {
    const dir = join(tmpDir, '20260225T1430_invalid_invariant_id');
    const badId = 'has a space';
    const ops = [
      {
        id: 'data.bad',
        label: 'Data: bad',
        operationClass: 'data' as const,
        name: 'bad',
        invariantId: badId,
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];
    // writeTestPackage would itself derive providedInvariants and throw,
    // so build the manifest by hand with stored-providedInvariants set
    // to match what the post-format-validation code *would* have
    // produced if the id were valid — but the fail point we test is the
    // verify-time format check, which fires before the comparison.
    const metadata = createTestMetadata({ providedInvariants: [badId] }, []);
    const { computeMigrationHash } = await import('../src/hash');
    const migrationHash = computeMigrationHash({ ...metadata, providedInvariants: [badId] }, ops);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'migration.json'),
      JSON.stringify({ ...metadata, providedInvariants: [badId], migrationHash }, null, 2),
    );
    await writeFile(join(dir, 'ops.json'), JSON.stringify(ops, null, 2));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_INVARIANT_ID');
      const mte = e as MigrationToolsError;
      expect(mte.meta).toEqual({ invariantId: badId });
      return true;
    });
  });

  it('throws MIGRATION.DUPLICATE_INVARIANT_IN_EDGE when two ops share an invariantId in ops.json', async () => {
    const dir = join(tmpDir, '20260225T1430_duplicate_invariant');
    const ops = [
      {
        id: 'data.first',
        label: 'Data: first',
        operationClass: 'data' as const,
        name: 'first',
        invariantId: 'shared',
        source: 'migration.ts',
        check: null,
        run: null,
      },
      {
        id: 'data.second',
        label: 'Data: second',
        operationClass: 'data' as const,
        name: 'second',
        invariantId: 'shared',
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];
    const metadata = createTestMetadata({ providedInvariants: ['shared'] }, []);
    const { computeMigrationHash } = await import('../src/hash');
    const migrationHash = computeMigrationHash(
      { ...metadata, providedInvariants: ['shared'] },
      ops,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'migration.json'),
      JSON.stringify({ ...metadata, providedInvariants: ['shared'], migrationHash }, null, 2),
    );
    await writeFile(join(dir, 'ops.json'), JSON.stringify(ops, null, 2));

    await expect(readMigrationPackage(dir, { migrationsDir: tmpDir })).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.DUPLICATE_INVARIANT_IN_EDGE');
      const mte = e as MigrationToolsError;
      expect(mte.meta).toEqual({ invariantId: 'shared' });
      return true;
    });
  });
});

describe('readMigrationsDir', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-dir-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns two packages sorted by name', async () => {
    await writeTestPackage(join(tmpDir, '20260225T1400_first'), {
      createdAt: '2026-02-25T14:00:00.000Z',
    });
    await writeTestPackage(join(tmpDir, '20260225T1500_second'), {
      createdAt: '2026-02-25T15:00:00.000Z',
    });

    const { packages } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    expect(packages).toHaveLength(2);
    expect(packages[0]!.dirName).toBe('20260225T1400_first');
    expect(packages[1]!.dirName).toBe('20260225T1500_second');
  });

  it('skips non-migration subdirectories', async () => {
    await writeTestPackage(join(tmpDir, '20260225T1400_valid'));
    await mkdir(join(tmpDir, 'README'), { recursive: true });
    await writeFile(join(tmpDir, 'README', 'content.md'), '# readme');

    const { packages } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    expect(packages).toHaveLength(1);
    expect(packages[0]!.dirName).toBe('20260225T1400_valid');
  });

  it('returns empty packages and problems arrays for an empty directory (pre-ENOENT path)', async () => {
    const { packages, problems } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    expect(packages).toHaveLength(0);
    expect(problems).toHaveLength(0);
  });

  it('rethrows non-ENOENT errors while reading migrations root', async () => {
    const notADirectory = join(tmpDir, 'not-a-directory.txt');
    await writeFile(notADirectory, 'content');

    await expect(readMigrationsDir(notADirectory, { migrationsDir: tmpDir })).rejects.toMatchObject(
      {
        code: 'ENOTDIR',
      },
    );
  });

  it('skips files (not directories) in root', async () => {
    await writeFile(join(tmpDir, '.gitkeep'), '');
    const { packages } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    expect(packages).toHaveLength(0);
  });

  it('returns a hashMismatch problem and retains the package when a child package is tampered', async () => {
    const intactDir = join(tmpDir, '20260225T1400_intact');
    const tamperedDir = join(tmpDir, '20260225T1500_tampered');
    const intactHash = '1'.repeat(64);
    const tamperedHash = '2'.repeat(64);

    await writeTestPackage(intactDir, { to: intactHash });
    await writeTestPackage(tamperedDir, { to: tamperedHash });
    await writeFile(join(tamperedDir, 'ops.json'), JSON.stringify([], null, 2));
    const intactJson = await writeEndContractSnapshot(tmpDir, intactHash, {
      marker: 'intact',
    });
    await writeEndContractSnapshot(tmpDir, tamperedHash, { marker: 'tampered' });

    const { packages, problems } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    // Both packages are retained (hashMismatch is recoverable)
    expect(packages).toHaveLength(2);
    expect(packages.map((p) => p.dirName).sort()).toEqual([
      '20260225T1400_intact',
      '20260225T1500_tampered',
    ]);
    // Snapshots are gated to verified packages: the tampered package's
    // snapshot must not be loadable (it could otherwise reach the ledger's
    // contract store), while the intact package keeps its snapshot.
    const intact = packages.find((p) => p.dirName === '20260225T1400_intact');
    const tampered = packages.find((p) => p.dirName === '20260225T1500_tampered');
    expect(intact?.endContractJson).toEqual(intactJson);
    expect(tampered && 'endContractJson' in tampered).toBe(false);
    // One problem: hashMismatch on the tampered package
    expect(problems).toHaveLength(1);
    const problem = problems[0]!;
    expect(problem.kind).toBe('hashMismatch');
    if (problem.kind !== 'hashMismatch') return;
    expect(problem.dirName).toBe('20260225T1500_tampered');
    expect(typeof problem.stored).toBe('string');
    expect(typeof problem.computed).toBe('string');
    expect(problem.stored).not.toBe(problem.computed);
  });

  it('returns a providedInvariantsMismatch problem and retains the package when manifest disagrees with ops', async () => {
    const dir = join(tmpDir, '20260225T1400_invariants_mismatch');
    const ops = [
      ...createTestOps(),
      {
        id: 'data.alpha',
        label: 'Data: alpha',
        operationClass: 'data' as const,
        name: 'alpha',
        invariantId: 'alpha',
        source: 'migration.ts',
        check: null,
        run: null,
      },
    ];
    await writeTestPackage(dir, { providedInvariants: ['alpha'] }, ops);

    // Tamper: add a phantom invariant with a re-computed hash so hashMismatch
    // does not fire first (the check fires if stored and derived sets differ).
    const manifestPath = join(dir, 'migration.json');
    const content = JSON.parse(await readFile(manifestPath, 'utf-8'));
    content.providedInvariants = ['alpha', 'phantom'];
    const { computeMigrationHash } = await import('../src/hash');
    content.migrationHash = computeMigrationHash(content, ops);
    await writeFile(manifestPath, JSON.stringify(content, null, 2));

    const { packages, problems } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    // Package is retained despite the mismatch
    expect(packages).toHaveLength(1);
    expect(packages[0]!.dirName).toBe('20260225T1400_invariants_mismatch');
    // Problem reported
    expect(problems).toHaveLength(1);
    const problem = problems[0]!;
    expect(problem.kind).toBe('providedInvariantsMismatch');
    if (problem.kind !== 'providedInvariantsMismatch') return;
    expect(problem.dirName).toBe('20260225T1400_invariants_mismatch');
  });

  it('returns a packageUnloadable problem and omits the package when migration.json is invalid JSON', async () => {
    const validDir = join(tmpDir, '20260225T1400_valid');
    const brokenDir = join(tmpDir, '20260225T1500_broken');

    await writeTestPackage(validDir);
    // Create a directory that looks like a migration package (has migration.json
    // when stat'd), then remove the file to simulate missing manifest.
    await mkdir(brokenDir, { recursive: true });
    // We need a migration.json to pass the stat() probe, then corrupt it.
    await writeFile(join(brokenDir, 'migration.json'), 'not json at all');
    await writeFile(join(brokenDir, 'ops.json'), '[]');

    const { packages, problems } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    // Only the valid package is in packages
    expect(packages).toHaveLength(1);
    expect(packages[0]!.dirName).toBe('20260225T1400_valid');
    // The broken package is reported as unloadable
    expect(problems).toHaveLength(1);
    const problem = problems[0]!;
    expect(problem.kind).toBe('packageUnloadable');
    if (problem.kind !== 'packageUnloadable') return;
    expect(problem.dirName).toBe('20260225T1500_broken');
    expect(typeof problem.detail).toBe('string');
    expect(problem.detail.length).toBeGreaterThan(0);
  });

  it('returns a packageUnloadable problem and omits the package when migration.json is schema-invalid', async () => {
    const dir = join(tmpDir, '20260225T1400_invalid_schema');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.json'), JSON.stringify({ from: 'x' }));
    await writeFile(join(dir, 'ops.json'), '[]');

    const { packages, problems } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    expect(packages).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.kind).toBe('packageUnloadable');
  });

  it('collects problems from multiple packages without stopping at the first', async () => {
    const dir1 = join(tmpDir, '20260225T1400_tampered');
    const dir2 = join(tmpDir, '20260225T1500_missing_manifest');

    await writeTestPackage(dir1);
    await writeFile(join(dir1, 'ops.json'), JSON.stringify([], null, 2));

    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir2, 'migration.json'), 'not json');
    await writeFile(join(dir2, 'ops.json'), '[]');

    const { packages, problems } = await readMigrationsDir(tmpDir, { migrationsDir: tmpDir });
    // tampered package is retained (hashMismatch), broken one is omitted (packageUnloadable)
    expect(packages).toHaveLength(1);
    expect(packages[0]!.dirName).toBe('20260225T1400_tampered');
    expect(problems).toHaveLength(2);
    const kinds = problems.map((p) => p.kind).sort();
    expect(kinds).toEqual(['hashMismatch', 'packageUnloadable']);
  });
});

describe('copyFilesWithRename', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-copy-files-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('copies each file byte-for-byte to destDir under the supplied destName', async () => {
    const sourceDir = join(tmpDir, 'src/prisma');
    await mkdir(sourceDir, { recursive: true });
    const sourceJson = join(sourceDir, 'contract.json');
    const sourceDts = join(sourceDir, 'contract.d.ts');
    const jsonPayload = JSON.stringify({ storage: { storageHash: 'abc' } });
    const dtsPayload = 'export type StorageHash = string;';
    await writeFile(sourceJson, jsonPayload);
    await writeFile(sourceDts, dtsPayload);

    const destDir = join(tmpDir, 'migrations/20260225T1430_test');

    await copyFilesWithRename(destDir, [
      { sourcePath: sourceJson, destName: 'contract.json' },
      { sourcePath: sourceDts, destName: 'contract.d.ts' },
    ]);

    expect(await readFile(join(destDir, 'contract.json'), 'utf-8')).toBe(jsonPayload);
    expect(await readFile(join(destDir, 'contract.d.ts'), 'utf-8')).toBe(dtsPayload);
  });

  it('renames destination filenames according to destName (source → renamed.*)', async () => {
    const sourceDir = join(tmpDir, 'src/prisma');
    await mkdir(sourceDir, { recursive: true });
    const sourceJson = join(sourceDir, 'contract.json');
    const sourceDts = join(sourceDir, 'contract.d.ts');
    await writeFile(sourceJson, '{"renamed":true}');
    await writeFile(sourceDts, '// dts');

    const destDir = join(tmpDir, 'migrations/20260225T1430_renamed');

    await copyFilesWithRename(destDir, [
      { sourcePath: sourceJson, destName: 'renamed.json' },
      { sourcePath: sourceDts, destName: 'renamed.d.ts' },
    ]);

    expect(await readFile(join(destDir, 'renamed.json'), 'utf-8')).toBe('{"renamed":true}');
    expect(await readFile(join(destDir, 'renamed.d.ts'), 'utf-8')).toBe('// dts');
  });

  it('creates the destination directory if it does not already exist', async () => {
    const sourceDir = join(tmpDir, 'src');
    await mkdir(sourceDir, { recursive: true });
    const source = join(sourceDir, 'a.json');
    await writeFile(source, '1');

    const destDir = join(tmpDir, 'nested/deeper/dest');

    await copyFilesWithRename(destDir, [{ sourcePath: source, destName: 'a.json' }]);

    expect(await readFile(join(destDir, 'a.json'), 'utf-8')).toBe('1');
  });

  it('throws ENOENT when a source file is missing', async () => {
    const destDir = join(tmpDir, 'migrations/20260225T1430_missing');

    await expect(
      copyFilesWithRename(destDir, [
        { sourcePath: join(tmpDir, 'does/not/exist.json'), destName: 'x.json' },
      ]),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resolves with no side effects when files is empty', async () => {
    const destDir = join(tmpDir, 'migrations/20260225T1430_empty');

    await copyFilesWithRename(destDir, []);

    const { packages: entries } = await readMigrationsDir(join(tmpDir, 'migrations'), {
      migrationsDir: join(tmpDir, 'migrations'),
    });
    expect(entries).toHaveLength(0);
  });
});

describe('copyFilesWithRename', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-copy-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('copies into destDir under the given destName', async () => {
    const src = join(tmpDir, 'source.json');
    await writeFile(src, '{"x":1}', 'utf-8');
    const destDir = join(tmpDir, 'dest');
    await copyFilesWithRename(destDir, [{ sourcePath: src, destName: 'contract.json' }]);
    expect(await readFile(join(destDir, 'contract.json'), 'utf-8')).toBe('{"x":1}');
  });

  it('rejects destName with path segments with MIGRATION.INVALID_DEST_NAME', async () => {
    const src = join(tmpDir, 'source.json');
    await writeFile(src, '{}', 'utf-8');
    const destDir = join(tmpDir, 'dest');
    await expect(
      copyFilesWithRename(destDir, [{ sourcePath: src, destName: '../outside.json' }]),
    ).rejects.toSatisfy((e) => {
      expectMigrationError(e, 'MIGRATION.INVALID_DEST_NAME');
      expect((e as MigrationToolsError).meta).toHaveProperty('destName', '../outside.json');
      return true;
    });
  });
});

describe('formatMigrationDirName', () => {
  it('formats with normal slug', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(formatMigrationDirName(ts, 'add_users')).toBe('20260225T1430_add_users');
  });

  it('sanitizes special characters', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(formatMigrationDirName(ts, 'Add Users!')).toBe('20260225T1430_add_users');
  });

  it('collapses consecutive underscores', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(formatMigrationDirName(ts, 'a___b')).toBe('20260225T1430_a_b');
  });

  it('trims leading/trailing underscores from slug', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    expect(formatMigrationDirName(ts, '__test__')).toBe('20260225T1430_test');
  });

  it('zero-pads timestamp', () => {
    const ts = new Date('2026-01-05T03:07:00Z');
    expect(formatMigrationDirName(ts, 'init')).toBe('20260105T0307_init');
  });

  it('truncates long slugs', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    const longSlug = 'a'.repeat(100);
    const result = formatMigrationDirName(ts, longSlug);
    expect(result.length).toBeLessThanOrEqual(13 + 1 + 64);
  });

  it('errors on empty slug with code MIGRATION.INVALID_NAME', () => {
    const ts = new Date('2026-02-25T14:30:00Z');
    try {
      formatMigrationDirName(ts, '!!!');
      expect.fail('expected error');
    } catch (e) {
      expectMigrationError(e, 'MIGRATION.INVALID_NAME');
      expect((e as MigrationToolsError).meta).toHaveProperty('slug', '!!!');
    }
  });
});
