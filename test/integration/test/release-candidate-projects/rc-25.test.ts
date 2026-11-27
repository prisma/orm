import { readdirSync, readFileSync } from 'node:fs';
import { computeExecutionHash, computeStorageHash } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { loadContractSpaceAggregate } from '@internal/migration-tools/aggregate';
import {
  createSnapshotContentVerifier,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import { verifyMigrationHash } from '@internal/migration-tools/hash';
import { readMigrationPackage } from '@internal/migration-tools/io';
import { readRefs } from '@internal/migration-tools/refs';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const fixturesDir = join(import.meta.dirname, 'fixtures/8.0.0-rc.25');

interface Project {
  readonly name: string;
  readonly contract: string;
  readonly hooks:
    | typeof sqlContractCanonicalizationHooks
    | typeof mongoContractCanonicalizationHooks;
  readonly deserializeContract: (json: unknown) => Contract;
}

const postgres = new PostgresContractSerializer();
const mongo = new MongoContractSerializer();

const projects: readonly Project[] = [
  {
    name: 'postgres-app',
    contract: 'src/prisma/contract.json',
    hooks: sqlContractCanonicalizationHooks,
    deserializeContract: (json) => postgres.deserializeContract(json),
  },
  {
    name: 'mongo-app',
    contract: 'src/contract.json',
    hooks: mongoContractCanonicalizationHooks,
    deserializeContract: (json) => mongo.deserializeContract(json),
  },
];

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.json'))
    .sort();
}

describe.each(projects)('the $name project 8.0.0-rc.25 wrote', (project) => {
  const root = join(fixturesDir, project.name);
  const migrationsDir = join(root, 'migrations');
  const readJson = (file: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(root, file), 'utf8'));
  const snapshots = readdirSync(join(migrationsDir, 'snapshots')).sort();
  const migrationDirs = readdirSync(join(migrationsDir, 'app')).filter((name) =>
    /^\d{8}T\d{4}_/.test(name),
  );
  const verifier = createSnapshotContentVerifier(project.hooks);

  function recordedAndComputedHashes(file: string) {
    const contract = readJson(file);
    const target = String(contract['target']);
    const targetFamily = String(contract['targetFamily']);
    const { storageHash, ...storage } = contract['storage'] as Record<string, unknown>;
    const recorded = contract['execution'] as Record<string, unknown> | undefined;
    const { executionHash, ...execution } = recorded ?? {};
    return {
      recorded: { storageHash, executionHash },
      computed: {
        storageHash: computeStorageHash({ target, targetFamily, storage, ...project.hooks }),
        executionHash:
          recorded === undefined
            ? undefined
            : computeExecutionHash({ target, targetFamily, execution }),
      },
    };
  }

  it('is in format version 0: no stored file has formatVersion, and each contract has "schemaVersion": "1"', () => {
    const files = jsonFiles(root);
    const contracts = [
      project.contract,
      ...snapshots.map((hash) => `migrations/snapshots/${hash}/contract.json`),
    ];
    expect({
      withFormatVersion: files.filter((file) => 'formatVersion' in readJson(file)),
      schemaVersions: contracts.map((file) => readJson(file)['schemaVersion']),
    }).toEqual({ withFormatVersion: [], schemaVersions: contracts.map(() => '1') });
  });

  it('records, in its contract and every snapshot, the storage and execution hashes computed from the contract', () => {
    const contracts = [
      project.contract,
      ...snapshots.map((hash) => `migrations/snapshots/${hash}/contract.json`),
    ].map(recordedAndComputedHashes);
    for (const { recorded, computed } of contracts) expect(recorded).toEqual(computed);
    expect(contracts.slice(1).map(({ recorded }) => recorded.storageHash)).toEqual(snapshots);
  });

  it('has a contract this release deserializes', () => {
    expect(project.deserializeContract(readJson(project.contract)).storage.storageHash).toBe(
      recordedAndComputedHashes(project.contract).recorded.storageHash,
    );
  });

  it('has snapshots the snapshot store reads with their content verified', async () => {
    for (const hash of snapshots) {
      const snapshot = await readContractSnapshotJson(migrationsDir, hash, verifier);
      expect(snapshot).toMatchObject({ formatVersion: 1, storage: { storageHash: hash } });
    }
  });

  it('has migrations whose migrationHash verifies and whose ends are snapshots', async () => {
    expect(migrationDirs.length).toBe(2);
    for (const dir of migrationDirs) {
      const pkg = await readMigrationPackage(join(migrationsDir, 'app', dir), { migrationsDir });
      const ends = [pkg.metadata.from, pkg.metadata.to].filter((hash) => hash !== null);
      expect({
        verified: verifyMigrationHash(pkg).ok,
        endsAreSnapshots: ends.every((hash) => snapshots.includes(hash)),
      }).toEqual({ verified: true, endsAreSnapshots: true });
    }
  });

  it('has refs that name snapshots', async () => {
    const refs = await readRefs(join(migrationsDir, 'app/refs'));
    expect(Object.keys(refs).sort()).toEqual(['db', 'production']);
    for (const ref of Object.values(refs)) expect(snapshots).toContain(ref.hash);
  });

  it('loads as a contract space with no integrity violation', async () => {
    const aggregate = await loadContractSpaceAggregate({
      migrationsDir,
      deserializeContract: project.deserializeContract,
      appContract: project.deserializeContract(readJson(project.contract)),
      verifySnapshotContent: verifier,
    });
    expect({
      packages: aggregate.app.packages.length,
      violations: aggregate.checkIntegrity({ checkContracts: true }),
    }).toEqual({ packages: 2, violations: [] });
  });
});
