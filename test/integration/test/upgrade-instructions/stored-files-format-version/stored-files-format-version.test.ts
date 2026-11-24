import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
const NO_FILE_CHANGED = 'Added the format version to no file.\n';
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
        stdout: NO_FILE_CHANGED,
        stderr:
          'Left unchanged:\n  other/contract.json: its "schemaVersion" is "2", which no release of Prisma wrote\n',
      },
      written: contract,
    });
  });
});

function runWith(files: Tree): {
  readonly run: ReturnType<typeof runScript>;
  readonly tree: Tree;
} {
  const root = copyFixture('after');
  for (const [path, content] of Object.entries(files)) writeFile(root, path, content);
  return { run: runScript(root), tree: readTree(root) };
}

describe('a stored file the script does not recognise', () => {
  function leftUnchanged(path: string, reason: string) {
    return {
      status: 1,
      stdout: NO_FILE_CHANGED,
      stderr: `Left unchanged:\n  ${path}: ${reason}\n`,
    };
  }

  it('reports a ref file with no invariants, which no release read, and exits 1', () => {
    const path = 'app/migrations/app/refs/staging.json';
    const content = '{"hash":"h"}\n';
    expect(runWith({ [path]: content })).toMatchObject({
      run: leftUnchanged(
        path,
        'a ref file has "hash" and "invariants", and this one has no "invariants" list. Add "invariants": [] (or the invariants the ref should carry) and run the script again',
      ),
      tree: { [path]: content },
    });
  });

  it('drops a field a ref file does not have, as an earlier release did when it rewrote the ref, and says so', () => {
    const path = 'app/migrations/app/refs/staging.json';
    const { run, tree } = runWith({
      [path]: '{\n  "hash": "h",\n  "note": "staging",\n  "invariants": [],\n  "owner": "ops"\n}\n',
    });
    expect({ run, written: tree[path] }).toEqual({
      run: {
        status: 0,
        stdout: `Added the format version to 1 file:\n  ${path}\nRemoved the fields a ref file does not have, which earlier releases ignored and dropped when they wrote the ref again:\n  ${path}: "note", "owner"\n`,
        stderr: '',
      },
      written: '{\n  "formatVersion": 1,\n  "hash": "h",\n  "invariants": []\n}\n',
    });
  });

  it('reports a ref file that is not a JSON object', () => {
    const path = 'app/migrations/app/refs/staging.json';
    expect(runWith({ [path]: '["h"]\n' }).run).toEqual(
      leftUnchanged(
        path,
        'a ref file is a JSON object with "hash" and "invariants", and this one is not an object',
      ),
    );
  });

  it('reports a migration.json next to an ops.json with a field the format does not have', () => {
    const path = 'app/migrations/app/20260520T1317_migration/migration.json';
    const content = JSON.stringify({
      from: null,
      to: 't',
      migrationHash: 'm',
      providedInvariants: [],
      createdAt: 'c',
      labels: [],
    });
    expect(runWith({ [path]: content })).toMatchObject({
      run: leftUnchanged(
        path,
        'it has the field "labels", which a migration.json does not have, so no release read it. Remove the field and run the script again',
      ),
      tree: { [path]: content },
    });
  });

  it('reports a migration.json next to an ops.json that lacks a field every migration.json has', () => {
    const path = 'app/migrations/app/20260520T1317_migration/migration.json';
    expect(runWith({ [path]: '{"from":null,"to":"t"}' }).run).toEqual(
      leftUnchanged(
        path,
        'it has no "migrationHash", which every migration.json has, so no release read it. Plan the migration again, or restore the file from version control',
      ),
    );
  });

  it('reports a contract with both formatVersion and schemaVersion', () => {
    const path = 'other/contract.json';
    const content = '{"formatVersion":1,"schemaVersion":"1","targetFamily":"sql","storage":{}}\n';
    expect(runWith({ [path]: content })).toMatchObject({
      run: leftUnchanged(
        path,
        'it has both "formatVersion" and "schemaVersion". Delete the "schemaVersion" field',
      ),
      tree: { [path]: content },
    });
  });

  it('reports a contract.json with neither field, which no release wrote', () => {
    const path = 'app/src/prisma/contract.json';
    expect(runWith({ [path]: '{"targetFamily":"sql","storage":{}}\n' }).run).toEqual(
      leftUnchanged(
        path,
        'it has neither "formatVersion" nor "schemaVersion", so no release of Prisma wrote it. Emit it again with `prisma contract emit`, or restore it from version control',
      ),
    );
  });

  it('leaves a contract.json that is not a Prisma contract alone', () => {
    expect(runWith({ 'other/contract.json': '{"name":"not prisma"}\n' }).run).toEqual({
      status: 0,
      stdout: NOTHING_CHANGED,
      stderr: '',
    });
  });
});

describe('where a ref file is', () => {
  it('leaves a JSON file in a refs folder that is not where Prisma keeps refs alone', () => {
    const files = {
      'app/src/i18n/refs/greeting.json': '{"en":"Hello"}\n',
      'app/src/i18n/refs/languages.json': '["en"]\n',
    };
    expect(runWith(files)).toMatchObject({
      run: { status: 0, stdout: NOTHING_CHANGED, stderr: '' },
      tree: files,
    });
  });

  it('leaves a JSON file in a refs folder next to a snapshots folder that another tool keeps alone', () => {
    const files = {
      'app/test/snapshots/user.test.ts.md': '# Snapshot report\n',
      'app/test/snapshots/user.test.ts.snap': 'AVA snapshot\n',
      'app/test/fixtures/refs/user.json': '{"name":"Ada"}\n',
    };
    expect(runWith(files)).toMatchObject({
      run: { status: 0, stdout: NOTHING_CHANGED, stderr: '' },
      tree: files,
    });
  });

  it('leaves a JSON file in a refs folder under another tool’s folder named migrations alone', () => {
    const files = {
      'app/db/migrations/20240101_create_users.js': 'exports.up = () => {};\n',
      'app/db/migrations/seeds/refs/user.json': '{"name":"Ada"}\n',
    };
    expect(runWith(files)).toMatchObject({
      run: { status: 0, stdout: NOTHING_CHANGED, stderr: '' },
      tree: files,
    });
  });

  it('rewrites a ref in a migrations folder configured under another name, in an application space and in an extension', () => {
    const ref = '{"hash":"h","invariants":[]}\n';
    const { run, tree } = runWith({
      'app/db/history/snapshots/269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6/contract.json':
        '{"formatVersion":1,"targetFamily":"sql","storage":{}}\n',
      'app/db/history/app/refs/db.json': ref,
      'ext/history/20260101T0000_init/migration.json':
        '{"formatVersion":1,"from":null,"to":"h","migrationHash":"m","providedInvariants":[],"createdAt":"c"}\n',
      'ext/history/20260101T0000_init/ops.json': '[]\n',
      'ext/history/refs/head.json': ref,
    });
    const written = '{"formatVersion":1,"hash":"h","invariants":[]}\n';
    expect({
      run,
      app: tree['app/db/history/app/refs/db.json'],
      extension: tree['ext/history/refs/head.json'],
    }).toEqual({
      run: {
        status: 0,
        stdout: `Added the format version to 2 files:\n${changedList(['app/db/history/app/refs/db.json', 'ext/history/refs/head.json'])}`,
        stderr: '',
      },
      app: written,
      extension: written,
    });
  });
});

describe('a symbolic link', () => {
  it('reports a link to a folder outside the project that holds stored files without a format version, and does not follow it', () => {
    const root = copyFixture('before');
    symlinkSync(join(root, 'extension/migrations'), join(root, 'app/shared-migrations'));
    const run = runScript(join(root, 'app'));
    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 1,
      stderr:
        'Left unchanged:\n  shared-migrations: is a symbolic link to ../extension/migrations, a folder outside the project that holds stored files the script would change or report; the script does not follow links. Run it on ../extension/migrations as well\n',
    });
    expect(readTree(join(root, 'extension'))).toEqual(
      readTree(join(fixturesDir, 'before/extension')),
    );
  });

  it('reports a link to a stored file outside the project', () => {
    const root = copyFixture('after');
    writeFile(root, 'shared/db.json', '{"hash":"h","invariants":[]}');
    symlinkSync(join(root, 'shared/db.json'), join(root, 'app/migrations/app/refs/shared.json'));
    expect(runScript(join(root, 'app'))).toEqual({
      status: 1,
      stdout: NO_FILE_CHANGED,
      stderr:
        'Left unchanged:\n  migrations/app/refs/shared.json: is a symbolic link to ../shared/db.json, a file outside the project that the script would change or report; the script does not follow links. Replace the link with the file, or add the format version to ../shared/db.json by hand\n',
    });
  });

  it('ignores a link to a folder with no stored files, a link inside the project, and a link that points nowhere', () => {
    const root = copyFixture('after');
    writeFile(root, 'assets/logo.json', '{"name":"logo"}');
    symlinkSync(join(root, 'assets'), join(root, 'app/linked-assets'));
    symlinkSync(join(root, 'app/migrations'), join(root, 'app/linked-migrations'));
    symlinkSync(join(root, 'missing'), join(root, 'app/dangling.json'));
    expect(runScript(join(root, 'app'))).toEqual({
      status: 0,
      stdout: NOTHING_CHANGED,
      stderr: '',
    });
  });

  it('ignores a link to the folder above the project, which holds the project itself', () => {
    const root = copyFixture('before');
    symlinkSync('..', join(root, 'app/a-parent'));
    const run = runScript(join(root, 'app'));
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
  });

  it('ignores a link to the project folder itself', () => {
    const root = copyFixture('before');
    symlinkSync('.', join(root, 'app/a-self'));
    const run = runScript(join(root, 'app'));
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' });
  });
});

describe('the final message', () => {
  it('does not say nothing changed when a file was left unhandled on a second run', () => {
    const root = copyFixture('before');
    writeFile(root, 'app/migrations/app/20260520T1317_migration/migration.json', '{ broken');
    runScript(root);
    const second = runScript(root);
    expect(second.status).toBe(1);
    expect(second.stdout).toBe(NO_FILE_CHANGED);
  });
});

describe('the layout of a rewritten file', () => {
  function rewritten(content: string, path = 'app/migrations/app/refs/db.json'): string {
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
