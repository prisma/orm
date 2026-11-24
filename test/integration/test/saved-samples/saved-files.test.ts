/**
 * The files of each saved sample set, as a release of Prisma 8 wrote them, read by this release: every contract, snapshot, migration and ref reads, and the hashes this release computes are the ones the files record.
 */

import { readdirSync } from 'node:fs';
import {
  assertContractHashes,
  type ExpectedContractHashes,
  type HashedContractSections,
} from '@internal/contract/hashing';
import {
  createSnapshotContentVerifier,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import { verifyMigrationHash } from '@internal/migration-tools/hash';
import { readMigrationsDir } from '@internal/migration-tools/io';
import { readRefs } from '@internal/migration-tools/refs';
import { contractFromJson as mongoContractFromJson } from '@internal/mongo/static';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { contractFromJson as postgresContractFromJson } from '@internal/postgres/static';
import {
  sqlContractCanonicalizationHooks,
  sqlProfileHashCapabilities,
} from '@internal/sql-contract/canonicalization-hooks';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  emittedContractPath,
  readSampleJson,
  type SampleDatabase,
  sampleProjectDir,
  sampleSetExists,
  sampleSpaces,
  savedReleases,
} from './sample-projects';

interface DatabaseReaders {
  readonly contractFromJson: (json: unknown) => unknown;
  readonly hashRules: Omit<Parameters<typeof assertContractHashes>[0], 'contracts'>;
}

const readers: Record<SampleDatabase, DatabaseReaders> = {
  postgres: {
    contractFromJson: (json) => postgresContractFromJson(json),
    hashRules: {
      ...sqlContractCanonicalizationHooks,
      profileHashCapabilities: sqlProfileHashCapabilities,
    },
  },
  mongo: {
    contractFromJson: (json) => mongoContractFromJson(json),
    hashRules: mongoContractCanonicalizationHooks,
  },
};

const sets = savedReleases().flatMap((release) =>
  (['postgres', 'mongo'] as const)
    .filter((database) => sampleSetExists(release, database))
    .map((database) => ({ release, database })),
);

interface StoredContract extends HashedContractSections {
  readonly storage: Record<string, unknown> & { readonly storageHash: string };
  readonly profileHash: string;
  readonly execution?: Record<string, unknown> & { readonly executionHash: string };
}

/** The hashes a saved contract records, as the expectations the hash rules are checked against. */
function recordedHashes(name: string, path: string): ExpectedContractHashes {
  const contract = readSampleJson(path) as StoredContract;
  return {
    name,
    contract,
    storageHash: contract.storage.storageHash,
    profileHash: contract.profileHash,
    ...(contract.execution === undefined
      ? {}
      : { executionHash: contract.execution.executionHash }),
  };
}

function directories(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

describe.each(sets)('the $database files $release wrote', ({ release, database }) => {
  const project = sampleProjectDir(release, database);
  const migrationsDir = join(project, 'migrations');
  const snapshotHashes = directories(join(migrationsDir, 'snapshots'), /^[0-9a-f]{64}$/);
  const contractFiles = [
    emittedContractPath[database],
    ...snapshotHashes.map((hash) => `migrations/snapshots/${hash}/contract.json`),
  ];
  const { contractFromJson, hashRules } = readers[database];
  const spaces = sampleSpaces(release, database);

  it('has contracts the facade reads', () => {
    for (const file of contractFiles) {
      expect(() => contractFromJson(readSampleJson(join(project, file))), file).not.toThrow();
    }
  });

  it('records, in the contract and every snapshot, the hashes this release computes', () => {
    expect(() =>
      assertContractHashes({
        contracts: contractFiles.map((file) => recordedHashes(file, join(project, file))),
        ...hashRules,
      }),
    ).not.toThrow();
  });

  it('names each snapshot by the storage hash this release computes for it', async () => {
    const verifier = createSnapshotContentVerifier(hashRules);
    const read = await Promise.all(
      snapshotHashes.map(async (hash) => {
        const snapshot = await readContractSnapshotJson(migrationsDir, hash, verifier);
        return (snapshot as StoredContract).storage.storageHash;
      }),
    );
    expect(read).toEqual(snapshotHashes);
  });

  it.each(spaces)('has %s migrations whose migrationHash verifies', async (space) => {
    const spaceDir = join(migrationsDir, space);
    const { packages, problems } = await readMigrationsDir(spaceDir, { migrationsDir });
    expect(problems).toEqual([]);
    expect(
      packages.map((pkg) => ({ dir: pkg.dirName, verified: verifyMigrationHash(pkg).ok })),
    ).toEqual(directories(spaceDir, /^\d{8}T\d{4}_/).map((dir) => ({ dir, verified: true })));
  });

  it('has application migrations whose ends are snapshots', async () => {
    const { packages } = await readMigrationsDir(join(migrationsDir, 'app'), { migrationsDir });
    const ends = packages.flatMap((pkg) => [pkg.metadata.from, pkg.metadata.to]);
    expect({
      migrations: packages.length,
      endsWithoutSnapshot: ends.filter((hash) => hash !== null && !snapshotHashes.includes(hash)),
    }).toEqual({
      migrations: directories(join(migrationsDir, 'app'), /^\d{8}T\d{4}_/).length,
      endsWithoutSnapshot: [],
    });
  });

  it.each(spaces)('has %s refs that name snapshots', async (space) => {
    const refs = await readRefs(join(migrationsDir, space, 'refs'));
    expect(Object.keys(refs).length).toBeGreaterThan(0);
    expect(Object.entries(refs).filter(([, ref]) => !snapshotHashes.includes(ref.hash))).toEqual(
      [],
    );
  });
});
