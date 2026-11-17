import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { materialiseMigrationPackage } from '../src/io';
import { createTestMetadata, createTestOps } from './fixtures';

describe('materialiseMigrationPackage', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'materialise-mig-pkg-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes manifest and ops under <targetDir>/<pkg.dirName>/', async () => {
    const ops = createTestOps();
    const metadata = createTestMetadata({}, ops);
    const pkg = { dirName: '20260507T1100_install', metadata, ops };

    await materialiseMigrationPackage(tmpDir, pkg);

    const dir = join(tmpDir, pkg.dirName);
    const entries = (await readdir(dir)).sort();
    expect(entries).toEqual(['migration.json', 'ops.json']);
  });

  it('produces byte-identical output across two writes of the same package to different dirs', async () => {
    const ops = createTestOps();
    const metadata = createTestMetadata({}, ops);
    const pkg = { dirName: 'baseline', metadata, ops };

    const dirA = join(tmpDir, 'a');
    const dirB = join(tmpDir, 'b');
    await materialiseMigrationPackage(dirA, pkg);
    await materialiseMigrationPackage(dirB, pkg);

    const aManifest = await readFile(join(dirA, pkg.dirName, 'migration.json'), 'utf-8');
    const bManifest = await readFile(join(dirB, pkg.dirName, 'migration.json'), 'utf-8');
    expect(aManifest).toBe(bManifest);

    const aOps = await readFile(join(dirA, pkg.dirName, 'ops.json'), 'utf-8');
    const bOps = await readFile(join(dirB, pkg.dirName, 'ops.json'), 'utf-8');
    expect(aOps).toBe(bOps);
  });

  it('overwrites the per-package directory idempotently and removes stale files', async () => {
    const ops = createTestOps();
    const metadata = createTestMetadata({}, ops);
    const pkg = { dirName: 'baseline', metadata, ops };
    const dir = join(tmpDir, pkg.dirName);

    await materialiseMigrationPackage(tmpDir, pkg);

    const firstManifest = await readFile(join(dir, 'migration.json'), 'utf-8');
    const firstOps = await readFile(join(dir, 'ops.json'), 'utf-8');

    await writeFile(join(dir, 'stale.json'), '{"stale":true}\n');
    expect((await readdir(dir)).sort()).toEqual(['migration.json', 'ops.json', 'stale.json']);

    await materialiseMigrationPackage(tmpDir, pkg);

    expect(await readFile(join(dir, 'migration.json'), 'utf-8')).toBe(firstManifest);
    expect(await readFile(join(dir, 'ops.json'), 'utf-8')).toBe(firstOps);
    expect((await readdir(dir)).sort()).toEqual(['migration.json', 'ops.json']);
  });

  it('creates the target directory if it does not yet exist', async () => {
    const nested = join(tmpDir, 'cipherstash');
    const pkg = {
      dirName: 'baseline',
      metadata: createTestMetadata({}, []),
      ops: [],
    };

    await materialiseMigrationPackage(nested, pkg);

    const dirStat = await stat(join(nested, 'baseline'));
    expect(dirStat.isDirectory()).toBe(true);
  });
});
