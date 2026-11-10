import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
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

const releaseProjects = [
  {
    name: 'rc14-lists',
    description: 'a Postgres project from 8.0.0-rc.14 with a list column and a list field',
    hashes: [
      '563f9e0b2a9d656e14bd2909f2f5864b160744a27b6922a2a3f10bf6df7abec8',
      '2830fe0ef5f06f7b80b4ab1a88117aed494e45538e6ea67fa6bce37d41ee7250',
    ],
  },
  {
    name: 'rc14-no-lists',
    description: 'a SQLite project from 8.0.0-rc.14 without lists',
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
  });
}

describe('a Postgres project from 8.0.0-rc.14 with a list column of an enum', () => {
  const run = upgrade('rc14-enum-list');
  const tree = readTree(run.root);
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
});
