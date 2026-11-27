import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeExtensionSpaceApplyPath } from '../src/compute-extension-space-apply-path';
import { emitContractSpaceArtifacts } from '../src/emit-contract-space-artifacts';
import { computeMigrationHash } from '../src/hash';
import { writeMigrationPackage } from '../src/io';

const HEAD = 'c'.repeat(64);
const DIR_NAME = '20260101T0000_install';

describe('computeExtensionSpaceApplyPath', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'extension-apply-path-'));
    await emitContractSpaceArtifacts(migrationsDir, 'ext', {
      contract: { formatVersion: 1, storage: { storageHash: HEAD } },
      contractDts: '\n',
      headRef: { hash: HEAD, invariants: [] },
    });
    const base = {
      from: null,
      to: HEAD,
      providedInvariants: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await writeMigrationPackage(
      join(migrationsDir, 'ext', DIR_NAME),
      { ...base, migrationHash: computeMigrationHash(base, []) },
      [],
    );
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('walks the migrations of the space to its head', async () => {
    const outcome = await computeExtensionSpaceApplyPath({
      projectMigrationsDir: migrationsDir,
      spaceId: 'ext',
      currentMarkerHash: null,
      currentMarkerInvariants: [],
    });

    expect(outcome).toMatchObject({ kind: 'ok', walkedMigrationDirs: [DIR_NAME] });
  });

  it('refuses a migration it cannot read, naming it, instead of walking the graph without it', async () => {
    const manifestPath = join(migrationsDir, 'ext', DIR_NAME, 'migration.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, zzz: 1 }), 'utf-8');

    await expect(
      computeExtensionSpaceApplyPath({
        projectMigrationsDir: migrationsDir,
        spaceId: 'ext',
        currentMarkerHash: null,
        currentMarkerInvariants: [],
      }),
    ).rejects.toMatchObject({ why: expect.stringContaining(manifestPath) });
  });
});
