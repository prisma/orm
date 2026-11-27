import { readdirSync, readFileSync } from 'node:fs';
import { convertContractDocument } from '@internal/contract/internal/format-version';
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

function nonEmpty(list: string[], what: string): string[] {
  if (list.length === 0) throw new Error(`The fixture has no ${what}`);
  return list;
}

function migrationDirs(side: Side, spaceDir: string): string[] {
  return migrationDirsIn(path(side, spaceDir), `${side}/${spaceDir}`);
}

function migrationDirsIn(dir: string, label: string): string[] {
  return nonEmpty(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{8}T\d{4}_/.test(entry.name))
      .map((entry) => entry.name),
    `migration packages in ${label}`,
  );
}

function snapshotHashes(side: Side, migrationsDir: string): string[] {
  return nonEmpty(
    readdirSync(path(side, join(migrationsDir, 'snapshots'))),
    `snapshots in ${side}/${migrationsDir}`,
  );
}

describe.each(Object.entries(projects))('the %s project after the script', (_name, project) => {
  it('has a contract this release deserializes', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(readJson('after', project.contract)),
    ).not.toThrow();
  });

  it('has migration packages this release reads, each with its unchanged migrationHash verified', async () => {
    for (const dir of migrationDirs('after', project.spaceDir)) {
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
      migrations: migrationDirsIn(join(root, extension.spaceDir), extension.spaceDir).map(
        (dirName) => ({
          dirName,
          metadata: json(join(extension.spaceDir, dirName, 'migration.json')),
          ops: json(join(extension.spaceDir, dirName, 'ops.json')),
        }),
      ),
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

  it('is read before the script as the same bundled contract space, in the newest format version', () => {
    expect(bundledSpace(join(fixturesDir, 'before'))).toEqual(
      bundledSpace(join(fixturesDir, 'after')),
    );
  });
});

describe.each(Object.entries(projects))(
  'the %s project before the script, which a release candidate wrote',
  (_name, project) => {
    it('has a contract each reader converts to the document the script writes', () => {
      const before = readJson('before', project.contract);
      const after = readJson('after', project.contract);
      expect({
        document: convertContractDocument(before),
        deserialized: new PostgresContractSerializer().deserializeContract(before),
      }).toEqual({
        document: after,
        deserialized: new PostgresContractSerializer().deserializeContract(after),
      });
    });

    it('has migration packages this release reads as the script writes them, each with its migrationHash verified', async () => {
      for (const dir of migrationDirs('before', project.spaceDir)) {
        const read = async (side: Side) => {
          const pkg = await readMigrationPackage(path(side, join(project.spaceDir, dir)), {
            migrationsDir: path(side, project.migrationsDir),
          });
          return { metadata: pkg.metadata, ops: pkg.ops, verified: verifyMigrationHash(pkg).ok };
        };
        expect(await read('before')).toEqual({ ...(await read('after')), verified: true });
      }
    });

    it('has snapshots this release reads as the script writes them, and leaves each file as it is', async () => {
      for (const hash of snapshotHashes('before', project.migrationsDir)) {
        const file = join(project.migrationsDir, 'snapshots', hash, 'contract.json');
        expect({
          read: await readContractSnapshotJson(path('before', project.migrationsDir), hash),
          onDisk: readFileSync(path('before', file), 'utf8'),
        }).toEqual({ read: readJson('after', file), onDisk: fixtureTree('before')[file] });
      }
    });
  },
);

describe('the app project before the script', () => {
  it('has ref files this release reads as the script writes them', async () => {
    expect(await readRefs(path('before', 'app/migrations/app/refs'))).toEqual(
      await readRefs(path('after', 'app/migrations/app/refs')),
    );
  });
});

describe.each(Object.entries(GUIDE_PATHS))('the %s guide detection', (_audience, guide) => {
  const patterns = detectionPatterns(guide, 'stored-files-format-version');
  const detects = (content: string) => patterns.some((pattern) => pattern.test(content));
  const before = fixtureTree('before');
  const after = fixtureTree('after');

  it('finds every stored file the script rewrites', () => {
    const rewritten = Object.keys(after).filter((file) => after[file] !== before[file]);
    expect(rewritten.length).toBeGreaterThan(0);
    expect(rewritten.filter((file) => !detects(before[file] ?? ''))).toEqual([]);
  });

  it('finds nothing after the script', () => {
    expect(
      Object.keys(after).filter((file) => file.endsWith('.json') && detects(after[file] ?? '')),
    ).toEqual(['app/docs/migration.json']);
  });
});
