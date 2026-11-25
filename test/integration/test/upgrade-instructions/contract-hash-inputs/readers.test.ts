import { readdirSync, readFileSync } from 'node:fs';
import { assertContractHashes, type ExpectedContractHashes } from '@internal/contract/hashing';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import {
  createSnapshotContentVerifier,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import { verifyMigrationHash } from '@internal/migration-tools/hash';
import { readMigrationPackage } from '@internal/migration-tools/io';
import { readRefs } from '@internal/migration-tools/refs';
import {
  assertDescriptorSelfConsistency,
  contractSpaceFromJson,
} from '@internal/migration-tools/spaces';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { fixturesDir, fixtureTree } from './test-helpers';

interface Project {
  readonly name: string;
  readonly family: 'sql' | 'mongo';
  readonly contract: string;
  readonly migrationsDir: string;
  readonly spaceDir: string;
  readonly refsDir: string;
}

const projects: readonly Project[] = [
  {
    name: 'postgres-app',
    family: 'sql',
    contract: 'postgres-app/src/prisma/contract.json',
    migrationsDir: 'postgres-app/migrations',
    spaceDir: 'postgres-app/migrations/app',
    refsDir: 'postgres-app/migrations/app/refs',
  },
  {
    name: 'mongo-app',
    family: 'mongo',
    contract: 'mongo-app/src/contract.json',
    migrationsDir: 'mongo-app/migrations',
    spaceDir: 'mongo-app/migrations/app',
    refsDir: 'mongo-app/migrations/app/refs',
  },
  {
    name: 'extension',
    family: 'sql',
    contract: 'extension/src/contract.json',
    migrationsDir: 'extension/migrations',
    spaceDir: 'extension/migrations',
    refsDir: 'extension/migrations/refs',
  },
];

const HOOKS = {
  sql: sqlContractCanonicalizationHooks,
  mongo: mongoContractCanonicalizationHooks,
} as const;

function path(relative: string): string {
  return join(fixturesDir, 'after', relative);
}

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path(relative), 'utf8'));
}

function directories(relative: string, pattern: RegExp): string[] {
  return readdirSync(path(relative), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => entry.name);
}

function snapshotHashes(project: Project): string[] {
  return directories(join(project.migrationsDir, 'snapshots'), /^[0-9a-f]{64}$/);
}

/** The hashes a saved contract stores, as the expectations `assertContractHashes` checks. */
function storedHashes(name: string, relative: string): ExpectedContractHashes {
  const contract = readJson(relative);
  const storage = contract['storage'] as { storageHash: string };
  const execution = contract['execution'] as { executionHash: string } | undefined;
  return {
    name,
    contract: contract as unknown as ExpectedContractHashes['contract'],
    storageHash: storage.storageHash,
    profileHash: contract['profileHash'] as string,
    ...(execution === undefined ? {} : { executionHash: execution.executionHash }),
  };
}

describe.each(projects)('the $name project after the script', (project) => {
  const contracts = [
    storedHashes(project.contract, project.contract),
    ...snapshotHashes(project).map((hash) => {
      const file = join(project.migrationsDir, 'snapshots', hash, 'contract.json');
      return storedHashes(file, file);
    }),
  ];

  it('stores, in every contract and snapshot, the hashes this release computes', () => {
    expect(() => assertContractHashes({ contracts, ...HOOKS[project.family] })).not.toThrow();
  });

  it('names each snapshot directory by its contract storage hash', () => {
    expect(snapshotHashes(project)).toEqual(
      contracts.slice(1).map((contract) => contract.storageHash),
    );
  });

  it('has snapshots the snapshot store reads with their content verified', async () => {
    const verifier = createSnapshotContentVerifier(HOOKS[project.family]);
    for (const hash of snapshotHashes(project))
      await expect(
        readContractSnapshotJson(path(project.migrationsDir), hash, verifier),
      ).resolves.toBeDefined();
  });

  it('has migrations whose migrationHash verifies and whose ends are snapshots', async () => {
    const snapshots = new Set(snapshotHashes(project));
    const dirs = directories(project.spaceDir, /^\d{8}T\d{4}_/);
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      const pkg = await readMigrationPackage(path(join(project.spaceDir, dir)), {
        migrationsDir: path(project.migrationsDir),
      });
      const ends = [pkg.metadata.from, pkg.metadata.to].filter((hash) => hash !== null);
      expect({
        verified: verifyMigrationHash(pkg).ok,
        endsAreSnapshots: ends.every((hash) => snapshots.has(hash)),
      }).toEqual({ verified: true, endsAreSnapshots: true });
    }
  });

  it('has refs that name snapshots', async () => {
    const snapshots = new Set(snapshotHashes(project));
    const refs = Object.values(await readRefs(path(project.refsDir)));
    for (const ref of refs) expect(snapshots.has(ref.hash)).toBe(true);
  });
});

describe('the emitted contracts after the script', () => {
  it('are deserialized by this release', () => {
    expect(() => {
      new PostgresContractSerializer().deserializeContract(
        readJson('postgres-app/src/prisma/contract.json'),
      );
      new PostgresContractSerializer().deserializeContract(readJson('extension/src/contract.json'));
      new MongoContractSerializer().deserializeContract(readJson('mongo-app/src/contract.json'));
    }).not.toThrow();
  });
});

describe('the extension package after the script', () => {
  const extension = projects[2] as Project;
  const migrations = directories(extension.spaceDir, /^\d{8}T\d{4}_/).map((dirName) => ({
    dirName,
    metadata: readJson(join(extension.spaceDir, dirName, 'migration.json')),
    ops: readJson(join(extension.spaceDir, dirName, 'ops.json')),
  }));

  it('is accepted as a bundled contract space whose head ref matches its contract', () => {
    const space = contractSpaceFromJson({
      spaceId: 'pgvector',
      contractJson: readJson(extension.contract),
      migrations,
      headRef: readJson(join(extension.refsDir, 'head.json')),
    });
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'pgvector',
        contractJson: space.contractJson,
        headRefHash: space.headRef.hash,
        ...sqlContractCanonicalizationHooks,
      }),
    ).not.toThrow();
  });

  it('was refused before the script, its head ref naming the old hash', () => {
    const before = fixtureTree('before', 'extension');
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: 'pgvector',
        contractJson: JSON.parse(before['src/contract.json'] ?? ''),
        headRefHash: JSON.parse(before['migrations/refs/head.json'] ?? '').hash,
        ...sqlContractCanonicalizationHooks,
      }),
    ).toThrow(expect.objectContaining({ code: 'MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH' }));
  });
});
