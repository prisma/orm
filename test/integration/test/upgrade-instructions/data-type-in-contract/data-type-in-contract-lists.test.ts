import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { SqliteContractSerializer } from '@internal/target-sqlite/runtime';
import { dirname, join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFixture,
  expectedTree,
  readTree,
  removeWorkDirs,
  runScript,
  upgrade,
  upgradeSummary,
} from './test-helpers';

afterAll(removeWorkDirs);

const here = dirname(fileURLToPath(import.meta.url));
const sqlOrmClientFixtures = join(here, '../../sql-orm-client/fixtures');
const portFixtures = join(here, '../../ports/prisma/functional');

const rowLockingCapabilityLine =
  /^\s*(?:readonly )?"?(?:forKeyShare|forNoKeyUpdate|forShare|forUpdate|lockNowait|lockOf|lockSkipLocked)"?: true[,;]\n/gm;

function readEmittedWithoutRowLockingCapabilities(path: string): string {
  return readFileSync(path, 'utf8').replace(rowLockingCapabilityLine, '');
}

const enumMemberTypesBlock = /^(\s*)readonly enumMemberTypes\?: \{\n[\s\S]*?^\1\};\n/m;

const releaseProjects = [
  {
    name: 'rc14-lists',
    description: 'a Postgres project from 8.0.0-rc.14 with a list column and a list field',
    emitted: join(sqlOrmClientFixtures, 'scalar-lists/generated'),
    serializer: new PostgresContractSerializer(),
    hashes: [
      '563f9e0b2a9d656e14bd2909f2f5864b160744a27b6922a2a3f10bf6df7abec8',
      '2830fe0ef5f06f7b80b4ab1a88117aed494e45538e6ea67fa6bce37d41ee7250',
    ],
  },
  {
    name: 'rc14-no-lists',
    description: 'a SQLite project from 8.0.0-rc.14 without lists',
    emitted: join(sqlOrmClientFixtures, 'integer-representation-sqlite/generated'),
    serializer: new SqliteContractSerializer(),
    hashes: [
      '17398e6d66de2a0c1a138453eac935af0f965aa197c409a946436619f204a21a',
      '28d0397503caeb837ce9b4e066368eb18074e3aa6ca3455388983c4164565eb6',
    ],
  },
] as const;

describe('a list column whose name is not ASCII', () => {
  it('declares the column a list in contract.d.ts', () => {
    const root = copyFixture('rc14-lists', 'before');
    const jsonPath = join(root, 'prisma/contract.json');
    const dtsPath = join(root, 'prisma/contract.d.ts');
    const contract = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const columns = contract.storage.namespaces.public.entries.table.item.columns;
    columns.étiquettes = columns.tags;
    delete columns.tags;
    writeFileSync(jsonPath, JSON.stringify(contract, null, 2));
    writeFileSync(
      dtsPath,
      readFileSync(dtsPath, 'utf8').replace(
        /readonly tags: \{(\s*readonly nativeType)/,
        'readonly étiquettes: {$1',
      ),
    );

    const run = runScript(root);

    expect({
      status: run.status,
      column: /readonly étiquettes: \{[^}]*\}/.exec(readFileSync(dtsPath, 'utf8'))?.[0],
    }).toEqual({
      status: 0,
      column: [
        'readonly étiquettes: {',
        "                  readonly dataType: 'pg/text';",
        "                  readonly codecId: 'pg/text@1';",
        '                  readonly nullable: false;',
        '                  readonly many: { readonly elementNullable: false }',
      ].join('\n'),
    });
  });
});

for (const project of releaseProjects) {
  describe(project.description, () => {
    const run = upgrade(project.name);
    const tree = readTree(run.root);
    const [oldHash, newHash] = project.hashes;

    it('upgrades every contract, snapshot, migration and ref', () => {
      expect({
        status: run.status,
        stdout: run.stdout,
        stderr: run.stderr,
        tree,
      }).toEqual({
        status: 0,
        stdout: upgradeSummary('Rewrote 5 files and renamed 1 snapshot directory.', [
          [oldHash, newHash],
        ]),
        stderr: '',
        tree: expectedTree(project.name, 'after'),
      });
    });

    it('writes contract.json and contract.d.ts as the current emitter writes them, without the row-locking capabilities rc.14 did not report', () => {
      expect([tree['prisma/contract.json'], tree['prisma/contract.d.ts']]).toEqual([
        readEmittedWithoutRowLockingCapabilities(join(project.emitted, 'contract.json')),
        readEmittedWithoutRowLockingCapabilities(join(project.emitted, 'contract.d.ts')),
      ]);
    });

    it('writes contracts that the target loads', () => {
      const contracts = [
        'prisma/contract.json',
        `migrations/snapshots/${newHash}/contract.json`,
      ].map((path) => JSON.parse(tree[path] ?? 'null'));
      for (const contract of contracts) {
        expect(() => project.serializer.deserializeContract(contract)).not.toThrow();
      }
    });
  });
}

describe('a Postgres project from 8.0.0-rc.14 with a list column of an enum', () => {
  const run = upgrade('rc14-enum-list');
  const tree = readTree(run.root);
  const emitted = join(portFixtures, 'enum-array/_fixture/generated');
  const oldHash = '28369815a587ef18873c40e9269de8b47a1f0d86f1c34db4748d24cd98cdb9cb';
  const newHash = '2d59ae34d8f960548d4ccab7dbf2fdf972c643c279b18fe71bd043dc3bfe7211';

  it('upgrades every contract, snapshot, migration and ref', () => {
    expect({ status: run.status, stdout: run.stdout, stderr: run.stderr, tree }).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 5 files and renamed 1 snapshot directory.', [
        [oldHash, newHash],
      ]),
      stderr: '',
      tree: expectedTree('rc14-enum-list', 'after'),
    });
  });

  it("keeps rc.14's membership check, so it differs from emission only in that check, the storage hash, and the row-locking capabilities and enum member types rc.14 did not write", () => {
    const upgradedContract = JSON.parse(tree['prisma/contract.json'] ?? 'null');
    const emittedContract = JSON.parse(
      readEmittedWithoutRowLockingCapabilities(join(emitted, 'contract.json')),
    );
    const checksOf = (contract: typeof emittedContract) =>
      contract.storage.namespaces.public.entries.table.user.checks;
    const membershipCheck = checksOf(upgradedContract)[0];
    const emittedHash = emittedContract.storage.storageHash;
    upgradedContract.storage.namespaces.public.entries.table.user.checks[0] =
      checksOf(emittedContract)[0];
    upgradedContract.storage.storageHash = emittedHash;
    expect({
      membershipCheck,
      withEmittedCheckAndHash: upgradedContract,
      dts: tree['prisma/contract.d.ts']?.replaceAll(newHash, emittedHash),
    }).toEqual({
      membershipCheck: {
        expression: `"plans"::text[] <@ ARRAY['FREE', 'PAID', 'CUSTOM']::text[]`,
        name: 'user_plans_check_86e31b31',
        prefix: 'user_plans_check',
      },
      withEmittedCheckAndHash: emittedContract,
      dts: readEmittedWithoutRowLockingCapabilities(join(emitted, 'contract.d.ts')).replace(
        enumMemberTypesBlock,
        '',
      ),
    });
  });

  it('writes a contract the target loads', () => {
    const contract = JSON.parse(tree['prisma/contract.json'] ?? 'null');
    expect(() => new PostgresContractSerializer().deserializeContract(contract)).not.toThrow();
  });
});
