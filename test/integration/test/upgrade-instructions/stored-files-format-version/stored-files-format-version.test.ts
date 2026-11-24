import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFixture,
  fixturesDir,
  fixtureTree,
  readTree,
  removeWorkDirs,
  repoRoot,
  runScript,
  SCRIPT_PATHS,
  type Tree,
} from './test-helpers';

afterAll(removeWorkDirs);

const REWRITTEN = [
  'app/migrations/app/20260520T1317_migration/migration.json',
  'app/migrations/app/20260601T1347_contract_hash_advance/migration.json',
  'app/migrations/app/20261016T1018_exit_code/migration.json',
  'app/migrations/app/refs/db.json',
  'app/migrations/app/refs/production.json',
  'app/migrations/app/refs/team/staging.json',
  'app/migrations/snapshots/269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6/contract.json',
  'app/migrations/snapshots/2c0677a6b6e5b60bb328a78d882483d8a00804e00c1e05fba259ff8304882558/contract.json',
  'app/migrations/snapshots/ab4b37f4e30e5935f5e9dc3b6cffb6fca4827e975950a41dfe30a10ed89f5cc3/contract.json',
  'app/src/prisma/contract.json',
  'extension/migrations/20261029T1520_create_citext_extension/migration.json',
  'extension/migrations/20261106T1036_find_citext_on_search_path/migration.json',
  'extension/migrations/20261106T1401_install_citext_on_search_path/migration.json',
  'extension/migrations/refs/head.json',
  'extension/migrations/snapshots/62dbb8d4183a5d944c332f5122eb9cea170bb06fa21f7c01fc9093cd074ffbfa/contract.json',
  'extension/migrations/snapshots/d4b1506484b9bdc7faf420bf5d126e61a22f193c94cdb9bb0f41eff0402e9d25/contract.json',
  'extension/src/contract.json',
];

const NOTHING_CHANGED = 'Every stored file already has a format version; nothing changed.\n';
const OLD_CONTRACT = 'app/src/prisma/contract.json';

function changedList(paths: readonly string[]): string {
  return paths.map((path) => `  ${path}\n`).join('');
}

function writeFile(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function withFiles(tree: Tree, files: Tree): Tree {
  return Object.fromEntries(
    Object.entries({ ...tree, ...files }).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function sorted(tree: Tree): Tree {
  return withFiles(tree, {});
}

describe('a project whose stored files have no format version', () => {
  const root = copyFixture('before');
  const run = runScript(root);

  it('adds the format version to every contract, snapshot, migration.json and ref file, and changes nothing else', () => {
    expect({ run, tree: sorted(readTree(root)) }).toEqual({
      run: {
        status: 0,
        stdout: `Added the format version to ${REWRITTEN.length} files:\n${changedList(REWRITTEN)}`,
        stderr: '',
      },
      tree: sorted(fixtureTree('after')),
    });
  });

  it('changes nothing on a second run', () => {
    expect(runScript(root)).toEqual({ status: 0, stdout: NOTHING_CHANGED, stderr: '' });
  });
});

describe('files the script leaves alone', () => {
  const after = fixtureTree('after');
  const before = fixtureTree('before');

  it('leaves a migration.json that is not in a migration package, and a JSON-with-comments file it cannot parse', () => {
    expect({
      migration: after['app/docs/migration.json'],
      tsconfig: after['app/tsconfig.json'],
    }).toEqual({
      migration: before['app/docs/migration.json'],
      tsconfig: before['app/tsconfig.json'],
    });
  });

  it('skips node_modules, dist, build and dot directories', () => {
    const root = copyFixture('after');
    const old = before[OLD_CONTRACT] ?? '';
    const skipped = {
      'app/node_modules/some-extension/contract.json': old,
      'app/dist/contract.json': old,
      'app/build/contract.json': old,
      'app/.turbo/contract.json': old,
    };
    for (const [path, content] of Object.entries(skipped)) writeFile(root, path, content);
    expect({ run: runScript(root), tree: sorted(readTree(root)) }).toEqual({
      run: { status: 0, stdout: NOTHING_CHANGED, stderr: '' },
      tree: withFiles(after, skipped),
    });
  });
});

describe('a stored file the script cannot rewrite', () => {
  it('reports a ref file that is not valid JSON, leaves it, rewrites the rest and exits 1', () => {
    const root = copyFixture('before');
    const broken = '{ "hash": ';
    writeFile(root, 'app/migrations/app/refs/broken.json', broken);
    const run = runScript(root);
    expect({ run, tree: sorted(readTree(root)) }).toEqual({
      run: {
        status: 1,
        stdout: `Added the format version to ${REWRITTEN.length} files:\n${changedList(REWRITTEN)}`,
        stderr: expect.stringMatching(
          /^Left unchanged:\n {2}app\/migrations\/app\/refs\/broken\.json: is not valid JSON \(.+\)\n$/,
        ),
      },
      tree: withFiles(fixtureTree('after'), { 'app/migrations/app/refs/broken.json': broken }),
    });
  });

  it('reports a contract whose schemaVersion no release wrote', () => {
    const root = copyFixture('after');
    const contract = '{"schemaVersion":"2","targetFamily":"sql","storage":{}}\n';
    writeFile(root, 'other/contract.json', contract);
    expect({
      run: runScript(root),
      written: readFileSync(join(root, 'other/contract.json'), 'utf8'),
    }).toEqual({
      run: {
        status: 1,
        stdout: NOTHING_CHANGED,
        stderr:
          'Left unchanged:\n  other/contract.json: its "schemaVersion" is "2", which no release of Prisma wrote\n',
      },
      written: contract,
    });
  });
});

describe('the layout of a rewritten file', () => {
  function rewritten(content: string, path = 'migrations/app/refs/db.json'): string {
    const root = copyFixture('after');
    writeFile(root, path, content);
    runScript(root);
    return readFileSync(join(root, path), 'utf8');
  }

  it.each([
    [
      'pretty-printed',
      '{\n  "hash": "h",\n  "invariants": []\n}\n',
      '{\n  "formatVersion": 1,\n  "hash": "h",\n  "invariants": []\n}\n',
    ],
    [
      'compact without a final newline',
      '{"hash":"h","invariants":[]}',
      '{"formatVersion":1,"hash":"h","invariants":[]}',
    ],
    [
      'on one line with spaces',
      '{ "hash": "h", "invariants": [] }\n',
      '{ "formatVersion": 1, "hash": "h", "invariants": [] }\n',
    ],
    [
      'with a byte order mark',
      '﻿{"hash":"h","invariants":[]}\n',
      '﻿{"formatVersion":1,"hash":"h","invariants":[]}\n',
    ],
  ])('keeps a ref file %s', (_layout, before, after) => {
    expect(rewritten(before)).toBe(after);
  });

  it('puts the version first in a contract whose keys are not sorted, where schemaVersion was not first', () => {
    expect(
      rewritten(
        '{\n  "targetFamily": "sql",\n  "schemaVersion": "1",\n  "storage": {}\n}\n',
        'src/contract.json',
      ),
    ).toBe('{\n  "formatVersion": 1,\n  "targetFamily": "sql",\n  "storage": {}\n}\n');
  });

  it('puts the version in sorted position in a contract whose keys are sorted, as the snapshot store writes it', () => {
    expect(
      rewritten(
        '{"schemaVersion":"1","storage":{},"targetFamily":"sql"}\n',
        'snapshots/x/contract.json',
      ),
    ).toBe('{"formatVersion":1,"storage":{},"targetFamily":"sql"}\n');
    expect(
      rewritten(
        '{"_generated":{},"domain":{},"schemaVersion":"1","storage":{},"targetFamily":"sql"}\n',
        'snapshots/y/contract.json',
      ),
    ).toBe('{"_generated":{},"domain":{},"formatVersion":1,"storage":{},"targetFamily":"sql"}\n');
  });
});

describe('the two audiences', () => {
  it('ship the same script', () => {
    expect(readFileSync(join(repoRoot, SCRIPT_PATHS.extension), 'utf8')).toBe(
      readFileSync(join(repoRoot, SCRIPT_PATHS.app), 'utf8'),
    );
  });

  it('rewrite an extension package with the extension copy', () => {
    const root = copyFixture('before');
    runScript(join(root, 'extension'), 'extension');
    expect(readTree(join(root, 'extension'))).toEqual(
      readTree(join(fixturesDir, 'after/extension')),
    );
  });
});
