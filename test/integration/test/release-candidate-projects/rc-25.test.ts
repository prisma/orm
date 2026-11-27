import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  assertContractHashes,
  type ExpectedContractHashes,
  type NormalizeStorage,
} from '@internal/contract/hashing';
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
import { normalizeMongoStorage } from '@internal/mongo-contract/normal-form';
import { normalizeSqlStorage } from '@internal/sql-contract/normal-form';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { runScript as runContractHashInputsScript } from '../upgrade-instructions/contract-hash-inputs/test-helpers';

const fixturesDir = join(import.meta.dirname, 'fixtures/8.0.0-rc.25');

interface Project {
  readonly name: string;
  readonly contract: string;
  readonly normalizeStorage: NormalizeStorage;
  readonly deserializeContract: (json: unknown) => Contract;
  readonly writtenHashes: Readonly<Record<string, Readonly<Record<string, string | null>>>>;
  readonly writtenTypeScriptHashes: Readonly<Record<string, readonly string[]>>;
}

const postgres = new PostgresContractSerializer();
const mongo = new MongoContractSerializer();

const projects: readonly Project[] = [
  {
    name: 'postgres-app',
    contract: 'src/prisma/contract.json',
    normalizeStorage: normalizeSqlStorage,
    deserializeContract: (json) => postgres.deserializeContract(json),
    writtenHashes: {
      'src/prisma/contract.json': {
        storageHash: '2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa',
        executionHash: '16a4fd61ef456e94cc8d4d061f14f5bfded380cd3268455cebf3e970f257eba4',
        profileHash: '3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2',
      },
      'migrations/snapshots/b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e/contract.json':
        {
          storageHash: 'b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e',
          executionHash: '16a4fd61ef456e94cc8d4d061f14f5bfded380cd3268455cebf3e970f257eba4',
          profileHash: '3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2',
        },
      'migrations/snapshots/2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa/contract.json':
        {
          storageHash: '2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa',
          executionHash: '16a4fd61ef456e94cc8d4d061f14f5bfded380cd3268455cebf3e970f257eba4',
          profileHash: '3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2',
        },
      'migrations/app/20261126T1044_init/migration.json': {
        from: null,
        to: 'b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e',
        migrationHash: 'aeee0dee190a0d1c6f20f4851c8380e9b7a9d7c3c20c0506892cf0b2fd708666',
      },
      'migrations/app/20261126T1044_add_post_body/migration.json': {
        from: 'b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e',
        to: '2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa',
        migrationHash: '0b60c360a878d62422b6b5a75c99a920cb56bec95b28e3281cf7b007710a906d',
      },
      'migrations/app/refs/db.json': {
        hash: 'b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e',
      },
      'migrations/app/refs/production.json': {
        hash: 'b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e',
      },
    },
    writtenTypeScriptHashes: {
      'migrations/app/20261126T1044_add_post_body/migration.ts': [
        '2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa',
        'b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e',
      ],
      'migrations/app/20261126T1044_init/migration.ts': [
        'b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e',
      ],
      'migrations/snapshots/2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa/contract.d.ts':
        [
          '16a4fd61ef456e94cc8d4d061f14f5bfded380cd3268455cebf3e970f257eba4',
          '2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa',
          '3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2',
        ],
      'migrations/snapshots/b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e/contract.d.ts':
        [
          '16a4fd61ef456e94cc8d4d061f14f5bfded380cd3268455cebf3e970f257eba4',
          '3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2',
          'b2a214eb94165a0088bb177d54215ccdf70f183dc6056f0b7cdf06733ca6129e',
        ],
      'src/prisma/contract.d.ts': [
        '16a4fd61ef456e94cc8d4d061f14f5bfded380cd3268455cebf3e970f257eba4',
        '2086eab7650a25284216465448157b277b4996ca09fc9fddd3c1591fed4fb2aa',
        '3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2',
      ],
    },
  },
  {
    name: 'mongo-app',
    contract: 'src/contract.json',
    normalizeStorage: normalizeMongoStorage,
    deserializeContract: (json) => mongo.deserializeContract(json),
    writtenHashes: {
      'src/contract.json': {
        storageHash: 'b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5',
        profileHash: '251b3ce23f6c9f561892e7c1af9d2cc941a13d64ba1aa7226b90036b09568cc3',
      },
      'migrations/snapshots/5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8/contract.json':
        {
          storageHash: '5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8',
          profileHash: '251b3ce23f6c9f561892e7c1af9d2cc941a13d64ba1aa7226b90036b09568cc3',
        },
      'migrations/snapshots/b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5/contract.json':
        {
          storageHash: 'b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5',
          profileHash: '251b3ce23f6c9f561892e7c1af9d2cc941a13d64ba1aa7226b90036b09568cc3',
        },
      'migrations/app/20261126T1044_init/migration.json': {
        from: null,
        to: '5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8',
        migrationHash: 'af6e59cc87ec63c2332c4a93413b26f2fd45a4323556ada28f763d1cb4ac72a8',
      },
      'migrations/app/20261126T1044_add_title_index/migration.json': {
        from: '5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8',
        to: 'b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5',
        migrationHash: '244cb1d84597192d16f38ced47256bd170841e5ef4c967c85ddc646e4aef3c96',
      },
      'migrations/app/refs/db.json': {
        hash: '5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8',
      },
      'migrations/app/refs/production.json': {
        hash: '5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8',
      },
    },
    writtenTypeScriptHashes: {
      'migrations/app/20261126T1044_add_title_index/migration.ts': [
        '5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8',
        'b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5',
      ],
      'migrations/app/20261126T1044_init/migration.ts': [
        '5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8',
      ],
      'migrations/snapshots/5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8/contract.d.ts':
        [
          '251b3ce23f6c9f561892e7c1af9d2cc941a13d64ba1aa7226b90036b09568cc3',
          '5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8',
        ],
      'migrations/snapshots/b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5/contract.d.ts':
        [
          '251b3ce23f6c9f561892e7c1af9d2cc941a13d64ba1aa7226b90036b09568cc3',
          'b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5',
        ],
      'src/contract.d.ts': [
        '251b3ce23f6c9f561892e7c1af9d2cc941a13d64ba1aa7226b90036b09568cc3',
        'b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5',
      ],
    },
  },
];

function typeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.d.ts') || file.endsWith('/migration.ts'))
    .sort();
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.json'))
    .sort();
}

const workDirs: string[] = [];

afterAll(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyOf(project: Project): string {
  const root = mkdtempSync(join(tmpdir(), 'rc-25-'));
  workDirs.push(root);
  cpSync(join(fixturesDir, project.name), root, { recursive: true });
  return root;
}

function projectFiles(root: string) {
  const migrationsDir = join(root, 'migrations');
  const readJson = (file: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(root, file), 'utf8'));
  const snapshots = readdirSync(join(migrationsDir, 'snapshots')).sort();
  const migrationDirs = readdirSync(join(migrationsDir, 'app')).filter((name) =>
    /^\d{8}T\d{4}_/.test(name),
  );
  return { migrationsDir, readJson, snapshots, migrationDirs };
}

describe.each(projects)('the $name project, as the 8.0.0-rc.25 CLI wrote it', (project) => {
  const root = join(fixturesDir, project.name);
  const { migrationsDir, readJson, snapshots, migrationDirs } = projectFiles(root);

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

  it('holds every hash 8.0.0-rc.25 wrote, unchanged, in every file that records one', () => {
    const hashKeys = new Set([
      'storageHash',
      'executionHash',
      'profileHash',
      'from',
      'to',
      'migrationHash',
      'hash',
    ]);
    const hashesIn = (value: unknown): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(Object(value)).flatMap(([key, entry]): [string, unknown][] =>
          hashKeys.has(key) && (entry === null || /^[0-9a-f]{64}$/.test(String(entry)))
            ? [[key, entry]]
            : entry !== null && typeof entry === 'object' && !Array.isArray(entry)
              ? Object.entries(hashesIn(entry))
              : [],
        ),
      );
    const recorded = Object.fromEntries(
      jsonFiles(root)
        .map((file): [string, Record<string, unknown>] => [file, hashesIn(readJson(file))])
        .filter(([, hashes]) => Object.keys(hashes).length > 0),
    );
    expect(recorded).toEqual(project.writtenHashes);
  });

  it('holds every hash 8.0.0-rc.25 wrote, unchanged, in its contract.d.ts and migration.ts files', () => {
    const recorded = Object.fromEntries(
      typeScriptFiles(root).map((file): [string, string[]] => [
        file,
        [...new Set(readFileSync(join(root, file), 'utf8').match(/[0-9a-f]{64}/g) ?? [])].sort(),
      ]),
    );
    expect(recorded).toEqual(project.writtenTypeScriptHashes);
  });

  it('has a contract this release deserializes', () => {
    const storage = readJson(project.contract)['storage'] as { storageHash: string };
    expect(project.deserializeContract(readJson(project.contract)).storage.storageHash).toBe(
      storage.storageHash,
    );
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
});

describe.each(projects)(
  'the $name project 8.0.0-rc.25 wrote, after the contract hash script ran on a copy of it',
  (project) => {
    const root = copyOf(project);
    const script = runContractHashInputsScript(root, 'app');
    const { migrationsDir, readJson, snapshots, migrationDirs } = projectFiles(root);
    const verifier = createSnapshotContentVerifier(project.normalizeStorage);

    function expectedHashes(file: string): ExpectedContractHashes {
      const contract = readJson(file);
      const storage = contract['storage'] as { storageHash: string };
      const execution = contract['execution'] as { executionHash: string } | undefined;
      return {
        name: file,
        contract: contract as unknown as ExpectedContractHashes['contract'],
        storageHash: storage.storageHash,
        profileHash: contract['profileHash'] as string,
        ...(execution === undefined ? {} : { executionHash: execution.executionHash }),
      };
    }

    it('is upgraded by the script, which leaves every file in format version 0', () => {
      const contracts = [
        project.contract,
        ...snapshots.map((hash) => `migrations/snapshots/${hash}/contract.json`),
      ];
      expect({
        status: script.status,
        stderr: script.stderr,
        withFormatVersion: jsonFiles(root).filter((file) => 'formatVersion' in readJson(file)),
        schemaVersions: contracts.map((file) => readJson(file)['schemaVersion']),
      }).toEqual({
        status: 0,
        stderr: '',
        withFormatVersion: [],
        schemaVersions: contracts.map(() => '1'),
      });
    });

    it('records, in its contract and every snapshot, the hashes computed from the contract', () => {
      const contracts = [
        expectedHashes(project.contract),
        ...snapshots.map((hash) => expectedHashes(`migrations/snapshots/${hash}/contract.json`)),
      ];
      expect(() =>
        assertContractHashes({ contracts, normalizeStorage: project.normalizeStorage }),
      ).not.toThrow();
      expect(contracts.slice(1).map((contract) => contract.storageHash)).toEqual(snapshots);
    });

    it('has a contract this release deserializes', () => {
      expect(project.deserializeContract(readJson(project.contract)).storage.storageHash).toBe(
        expectedHashes(project.contract).storageHash,
      );
    });

    it('has snapshots the snapshot store reads with their content verified', async () => {
      expect(snapshots.length).toBe(2);
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
  },
);
