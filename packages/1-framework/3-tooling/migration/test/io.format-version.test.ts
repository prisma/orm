import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeMigrationHash, verifyMigrationHash } from '../src/hash';
import { readMigrationPackage, readMigrationsDir, writeMigrationPackage } from '../src/io';
import { createTestMetadata, createTestOps } from './fixtures';

describe('migration.json format version', () => {
  let migrationsDir: string;
  let packageDir: string;
  const manifestPath = () => join(packageDir, 'migration.json');

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'migration-format-version-'));
    packageDir = join(migrationsDir, '20260101T0000_init');
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  async function writeManifest(document: Record<string, unknown>): Promise<void> {
    await mkdir(packageDir, { recursive: true });
    await writeFile(manifestPath(), JSON.stringify(document, null, 2));
    await writeFile(join(packageDir, 'ops.json'), JSON.stringify(createTestOps(), null, 2));
  }

  it('is written first, as 1', async () => {
    const metadata = createTestMetadata({}, createTestOps());
    await writeMigrationPackage(packageDir, metadata, createTestOps());
    const written = JSON.parse(await readFile(manifestPath(), 'utf-8'));
    expect(Object.keys(written)[0]).toBe('formatVersion');
    expect(written).toEqual({ formatVersion: 1, ...metadata });
  });

  it('does not change the hash of a migration.json it is added to', async () => {
    const ops = createTestOps();
    const { migrationHash: _, ...unattested } = createTestMetadata({}, ops);
    const hashWithoutTheField = computeMigrationHash(unattested, ops);
    await writeManifest({ formatVersion: 1, ...unattested, migrationHash: hashWithoutTheField });

    const pkg = await readMigrationPackage(packageDir, { migrationsDir });
    expect(pkg.metadata).toEqual({ ...unattested, migrationHash: hashWithoutTheField });
    expect(pkg.metadata).not.toHaveProperty('formatVersion');
  });

  it('refuses a migration.json written by a newer release', async () => {
    await writeManifest({ ...createTestMetadata({}, createTestOps()), formatVersion: 2 });
    await expect(readMigrationPackage(packageDir, { migrationsDir })).rejects.toMatchObject({
      code: 'MIGRATION.FORMAT_VERSION_NEWER',
      where: { path: manifestPath() },
    });
  });

  it('reads a migration.json a release candidate wrote with no format version, with its hash verified, and leaves the file as it is', async () => {
    const metadata = createTestMetadata({}, createTestOps());
    await writeManifest({ ...metadata });
    const pkg = await readMigrationPackage(packageDir, { migrationsDir });
    expect({
      metadata: pkg.metadata,
      verified: verifyMigrationHash(pkg).ok,
      onDisk: JSON.parse(await readFile(manifestPath(), 'utf-8')),
    }).toEqual({ metadata, verified: true, onDisk: metadata });
  });

  it('refuses a migration.json with the old schemaVersion field', async () => {
    await writeManifest({ schemaVersion: '1', ...createTestMetadata({}, createTestOps()) });
    await expect(readMigrationPackage(packageDir, { migrationsDir })).rejects.toMatchObject({
      code: 'MIGRATION.FORMAT_VERSION_MISSING',
    });
  });

  it('refuses a migration.json with a field it does not know', async () => {
    await writeManifest({ formatVersion: 1, ...createTestMetadata({}, createTestOps()), x: 1 });
    await expect(readMigrationPackage(packageDir, { migrationsDir })).rejects.toMatchObject({
      code: 'MIGRATION.INVALID_MANIFEST',
    });
  });

  it('is not tolerated as an unloadable package when reading a directory', async () => {
    await writeManifest({ ...createTestMetadata({}, createTestOps()), formatVersion: 2 });
    await expect(readMigrationsDir(migrationsDir, { migrationsDir })).rejects.toMatchObject({
      code: 'MIGRATION.FORMAT_VERSION_NEWER',
    });
  });
});
