import { readdirSync, readFileSync } from 'node:fs';
import {
  contractSnapshotFiles,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import { verifyMigrationHash } from '@internal/migration-tools/hash';
import { readMigrationPackage } from '@internal/migration-tools/io';
import { readRefs } from '@internal/migration-tools/refs';
import {
  assertDescriptorSelfConsistency,
  contractSpaceFromJson,
} from '@internal/migration-tools/spaces';
import { normalizeSqlStorage } from '@internal/sql-contract/normal-form';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { runScript as runContractHashInputsScript } from '../contract-hash-inputs/test-helpers';
import { detectionPatterns } from '../guide-detections';
import { copyFixture, fixturesDir, fixtureTree, GUIDE_PATHS, removeWorkDirs } from './test-helpers';

afterAll(removeWorkDirs);

const projects = {
  app: {
    migrationsDir: 'app/migrations',
    spaceDir: 'app/migrations/app',
    contract: 'app/src/prisma/contract.json',
  },
  extension: {
    migrationsDir: 'extension/migrations',
    spaceDir: 'extension/migrations',
    contract: 'extension/src/contract.json',
  },
} as const;

type Side = 'before' | 'after';

function path(side: Side, relative: string): string {
  return join(fixturesDir, side, relative);
}

function readJson(side: Side, relative: string): unknown {
  return JSON.parse(readFileSync(path(side, relative), 'utf8'));
}

function migrationDirs(side: Side, spaceDir: string): string[] {
  return migrationDirsIn(path(side, spaceDir));
}

function migrationDirsIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{8}T\d{4}_/.test(entry.name))
    .map((entry) => entry.name);
}

function snapshotHashes(side: Side, migrationsDir: string): string[] {
  return readdirSync(path(side, join(migrationsDir, 'snapshots')));
}

describe.each(Object.entries(projects))('the %s project after the script', (_name, project) => {
  it('has a contract this release deserializes', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(readJson('after', project.contract)),
    ).not.toThrow();
  });

  it('has migration packages this release reads, each with its unchanged migrationHash verified', async () => {
    const dirs = migrationDirs('after', project.spaceDir);
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const pkg = await readMigrationPackage(path('after', join(project.spaceDir, dir)), {
        migrationsDir: path('after', project.migrationsDir),
      });
      const before = readJson('before', join(project.spaceDir, dir, 'migration.json'));
      expect({ verified: verifyMigrationHash(pkg).ok, before }).toMatchObject({
        verified: true,
        before: { migrationHash: pkg.metadata.migrationHash },
      });
    }
  });

  it('has snapshots this release reads, in the bytes the snapshot store writes', async () => {
    for (const hash of snapshotHashes('after', project.migrationsDir)) {
      const snapshot = await readContractSnapshotJson(path('after', project.migrationsDir), hash);
      const file = join(project.migrationsDir, 'snapshots', hash, 'contract.json');
      expect(contractSnapshotFiles({ contractJson: snapshot, contractDts: '' }).contractJson).toBe(
        fixtureTree('after')[file],
      );
    }
  });
});

describe('the app project after the script', () => {
  it('has ref files this release reads, policies included', async () => {
    expect(await readRefs(path('after', 'app/migrations/app/refs'))).toEqual({
      db: {
        hash: 'ab4b37f4e30e5935f5e9dc3b6cffb6fca4827e975950a41dfe30a10ed89f5cc3',
        invariants: [],
      },
      production: {
        hash: 'ab4b37f4e30e5935f5e9dc3b6cffb6fca4827e975950a41dfe30a10ed89f5cc3',
        invariants: ['backfill-exit-code'],
        policies: {
          change: ['migrate'],
          dataProtection: {
            dataLoss: 'data-loss-with-consent',
            accessWidening: 'access-widening-forbidden',
          },
        },
      },
      'team/staging': {
        hash: '269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6',
        invariants: [],
      },
    });
  });
});

describe('the extension package after the script', () => {
  const extension = projects.extension;

  function bundledSpace(root: string) {
    const json = (relative: string): unknown =>
      JSON.parse(readFileSync(join(root, relative), 'utf8'));
    return contractSpaceFromJson({
      spaceId: 'fixture-extension',
      contractJson: json(extension.contract),
      migrations: migrationDirsIn(join(root, extension.spaceDir)).map((dirName) => ({
        dirName,
        metadata: json(join(extension.spaceDir, dirName, 'migration.json')),
        ops: json(join(extension.spaceDir, dirName, 'ops.json')),
      })),
      headRef: json(join(extension.spaceDir, 'refs/head.json')),
    });
  }

  it('is accepted as a bundled contract space whose head ref matches its contract once the contract hash step has run', () => {
    const root = copyFixture('after');
    const hashInputs = runContractHashInputsScript(join(root, 'extension'), 'extension');
    expect({ status: hashInputs.status, stderr: hashInputs.stderr }).toEqual({
      status: 0,
      stderr: '',
    });
    const space = bundledSpace(root);
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'citext',
        contractJson: space.contractJson,
        headRefHash: space.headRef.hash,
        normalizeStorage: normalizeSqlStorage,
      }),
    ).not.toThrow();
  });

  it('was refused as a bundled contract space before', () => {
    expect(() => bundledSpace(join(fixturesDir, 'before'))).toThrow(
      expect.objectContaining({ code: 'CONTRACT.FORMAT_VERSION_MISSING' }),
    );
  });
});

describe('the app project before the script', () => {
  const app = projects.app;

  it('is refused by every reader for having no format version', async () => {
    const migrationDir = migrationDirs('before', app.spaceDir)[0] ?? '';
    const snapshot = snapshotHashes('before', app.migrationsDir)[0] ?? '';
    expect({
      contract: codeOf(() =>
        new PostgresContractSerializer().deserializeContract(readJson('before', app.contract)),
      ),
      migration: await rejectionCodeOf(
        readMigrationPackage(path('before', join(app.spaceDir, migrationDir)), {
          migrationsDir: path('before', app.migrationsDir),
        }),
      ),
      refs: await rejectionCodeOf(readRefs(path('before', 'app/migrations/app/refs'))),
      snapshot: await rejectionCodeOf(
        readContractSnapshotJson(path('before', app.migrationsDir), snapshot),
      ),
    }).toEqual({
      contract: 'CONTRACT.FORMAT_VERSION_MISSING',
      migration: 'MIGRATION.FORMAT_VERSION_MISSING',
      refs: 'MIGRATION.FORMAT_VERSION_MISSING',
      snapshot: 'CONTRACT.FORMAT_VERSION_MISSING',
    });
  });
});

function codeOf(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
}

async function rejectionCodeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
}

describe.each(Object.entries(GUIDE_PATHS))('the %s guide detection', (_audience, guide) => {
  const patterns = detectionPatterns(guide, 'stored-files-format-version');
  const detects = (content: string) => patterns.some((pattern) => pattern.test(content));
  const before = fixtureTree('before');
  const after = fixtureTree('after');

  it('finds every stored file the script rewrites', () => {
    const rewritten = Object.keys(after).filter((file) => after[file] !== before[file]);
    expect(rewritten.filter((file) => !detects(before[file] ?? ''))).toEqual([]);
  });

  it('finds nothing after the script', () => {
    expect(
      Object.keys(after).filter((file) => file.endsWith('.json') && detects(after[file] ?? '')),
    ).toEqual(['app/docs/migration.json']);
  });
});
