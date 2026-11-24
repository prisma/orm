import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFixture,
  editFile,
  fixtureTree,
  readTree,
  removeWorkDirs,
  repoRoot,
  runScript,
  SCRIPT_PATHS,
} from './test-helpers';

afterAll(removeWorkDirs);

const NOTHING_CHANGED =
  'Every stored hash already has the value this release computes; nothing changed.\n';

const POSTGRES_HEAD_SNAPSHOT =
  'postgres-app/migrations/snapshots/6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1';
const REMOVED_HASH = '6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1';
const REMOVED_HASH_NEW_VALUE = '345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4';
const BACKFILL_HASH = '5b423686089e2ada5ece2b224849ac73ce6b998fb062e88217d2f30a1a567748';
const BACKFILL_HASH_NEW_VALUE = 'f6146e922053633f815e208705396f57f232a93ac6a95e78b39ee7fb695d0d70';
const MONGO_CONTRACT = 'mongo-app/src/contract.json';
const MONGO_STORAGE_HASH = '1c73a5a88943362a9b01f6476e85fddc574031accb9ada12be61e9da24fe0fd8';

function rewrittenFiles(): string[] {
  const before = fixtureTree('before');
  const after = fixtureTree('after');
  return Object.keys(after).filter((path) => after[path] !== before[path]);
}

describe('an application and an extension with hashes under the old rules', () => {
  const root = copyFixture('before');
  const run = runScript(root);

  it('gives every stored hash its new value and changes nothing else', () => {
    const rewritten = rewrittenFiles();
    expect({
      status: run.status,
      stderr: run.stderr,
      head: run.stdout.slice(0, run.stdout.indexOf('Renamed snapshot directories:')),
      tree: readTree(root),
    }).toEqual({
      status: 0,
      stderr: '',
      head: `Rewrote ${rewritten.length} files:\n${rewritten.map((path) => `  ${path}\n`).join('')}`,
      tree: fixtureTree('after'),
    });
  });

  it('reports each renamed snapshot directory and each replaced hash', () => {
    expect(run.stdout).toContain(
      `  ${POSTGRES_HEAD_SNAPSHOT} -> 345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4\n`,
    );
    expect(run.stdout).toContain(
      'Profile hashes (old -> new):\n' +
        '  251b3ce23f6c9f561892e7c1af9d2cc941a13d64ba1aa7226b90036b09568cc3 -> 8fe2b3350db5a83e2473520e59e52262982215115e17bb22a76239170eee6e69\n' +
        '  3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2 -> ae77f23935a24b8a63c81ef26bb0f186581670a56e603cef8314a629414e2632\n',
    );
  });

  it('lists the snapshots whose profile and execution hash an earlier release wrote by other rules', () => {
    expect(run.stdout).toContain(
      `  ${POSTGRES_HEAD_SNAPSHOT}/contract.json (profile hash and execution hash)\n`,
    );
  });

  it('rewrites the storage hash a data transform writes into ops.json', () => {
    const ops = 'mongo-app/migrations/app/20260513T0508_backfill_product_status/ops.json';
    expect({
      before: fixtureTree('before')[ops]?.includes(BACKFILL_HASH),
      after: readTree(root)[ops]?.includes(BACKFILL_HASH_NEW_VALUE),
    }).toEqual({ before: true, after: true });
  });

  it('changes nothing on a second run', () => {
    expect(runScript(root)).toEqual({ status: 0, stdout: NOTHING_CHANGED, stderr: '' });
    expect(readTree(root)).toEqual(fixtureTree('after'));
  });
});

describe('the extension copy of the script', () => {
  it('is the same file as the application copy', () => {
    expect(readFileSync(join(repoRoot, SCRIPT_PATHS.extension), 'utf8')).toBe(
      readFileSync(join(repoRoot, SCRIPT_PATHS.app), 'utf8'),
    );
  });

  it('upgrades an extension package on its own', () => {
    const root = copyFixture('before', 'extension');
    expect(runScript(root, 'extension').status).toBe(0);
    expect(readTree(root)).toEqual(fixtureTree('after', 'extension'));
  });
});

describe('a project the script refuses, changing no file', () => {
  it('names a contract whose storage hash its content does not give', () => {
    const root = copyFixture('before');
    editFile(root, MONGO_CONTRACT, (text) => text.replace(MONGO_STORAGE_HASH, 'a'.repeat(64)));
    const edited = readTree(root);
    expect({ run: runScript(root), tree: readTree(root) }).toEqual({
      run: {
        status: 1,
        stdout: '',
        stderr: `Changed no file, because:\n  ${MONGO_CONTRACT}: its storage hash "${'a'.repeat(64)}" is not the one its content gives, ${MONGO_STORAGE_HASH}. The file was edited by hand or comes from another release: restore it from version control, or emit it again, and run the script again\n`,
      },
      tree: edited,
    });
  });

  it('names a snapshot directory whose name is not its contract storage hash', () => {
    const root = copyFixture('before', 'mongo-app');
    const snapshot = `migrations/snapshots/${MONGO_STORAGE_HASH}/contract.json`;
    editFile(root, snapshot, (text) =>
      text.replace('"collection":{', '"collection":{"added_by_hand":{},'),
    );
    const edited = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stdout: run.stdout, tree: readTree(root) }).toEqual({
      status: 1,
      stdout: '',
      tree: edited,
    });
    expect(run.stderr).toContain(
      `  ${snapshot}: its storage hash "${MONGO_STORAGE_HASH}" is not the one its content gives,`,
    );
    expect(run.stderr).toContain(
      `its snapshot directory is named ${MONGO_STORAGE_HASH}, which is not the storage hash its content gives,`,
    );
  });

  it('names a migration.json whose migrationHash is not the hash of the migration', () => {
    const root = copyFixture('before', 'extension');
    const migration = 'migrations/20261029T1342_create_vector_extension/migration.json';
    editFile(root, migration, (text) => text.replace('"createdAt": "', '"createdAt": "1'));
    const edited = readTree(root);
    expect({ run: runScript(root), tree: readTree(root) }).toEqual({
      run: {
        status: 1,
        stdout: '',
        stderr: `Changed no file, because:\n  ${migration}: its "migrationHash" is not the hash of the migration; it was edited by hand. Restore it from version control, or plan the migration again, and run the script again\n`,
      },
      tree: edited,
    });
  });

  it('names a stored file without a format version, and the step that adds it', () => {
    const root = copyFixture('before', 'extension');
    editFile(root, 'migrations/refs/head.json', (text) => text.replace('"formatVersion": 1,', ''));
    const edited = readTree(root);
    expect({ run: runScript(root), tree: readTree(root) }).toEqual({
      run: {
        status: 1,
        stdout: '',
        stderr:
          'Changed no file, because:\n  migrations/refs/head.json: has no "formatVersion"; run the `stored-files-format-version` script of the earlier upgrade step first, then this script again\n',
      },
      tree: edited,
    });
  });
});

describe('a migration naming a contract the project has no snapshot of', () => {
  const root = copyFixture('before', 'postgres-app');
  rmSync(join(root, POSTGRES_HEAD_SNAPSHOT.replace('postgres-app/', '')), { recursive: true });
  const run = runScript(root);
  const after = fixtureTree('after', 'postgres-app');
  const before = fixtureTree('before', 'postgres-app');
  const tree = readTree(root);
  const unresolved = Object.keys(before).filter(
    (path) => path.endsWith('/migration.json') && before[path]?.includes(REMOVED_HASH),
  );

  it('is left unchanged, reported, and makes the script exit 1', () => {
    expect(unresolved.length).toBeGreaterThan(0);
    expect({
      status: run.status,
      left: unresolved.map((path) => tree[path] === before[path]),
    }).toEqual({ status: 1, left: unresolved.map(() => true) });
    for (const path of unresolved) expect(run.stderr).toContain(`  ${path}: its "`);
  });

  it('does not keep the script from rewriting the rest of the project', () => {
    const naming = (path: string) => before[path]?.includes(REMOVED_HASH) === true;
    const rest = Object.keys(after).filter(
      (path) => !naming(path) && !path.includes(REMOVED_HASH_NEW_VALUE),
    );
    expect(rest.length).toBeGreaterThan(0);
    expect(Object.fromEntries(rest.map((path) => [path, tree[path]]))).toEqual(
      Object.fromEntries(rest.map((path) => [path, after[path]])),
    );
  });
});

describe('a contract.json with no format version of either kind', () => {
  it('is left alone and reported, and the rest of the project is upgraded', () => {
    const root = copyFixture('before', 'extension');
    mkdirSync(join(root, 'test'));
    writeFileSync(
      join(root, 'test/contract.json'),
      '{ "targetFamily": "sql", "target": "postgres", "storage": {} }\n',
    );
    const run = runScript(root, 'extension');
    expect({
      status: run.status,
      stderr: run.stderr,
      upgraded:
        readTree(root)['src/contract.json'] ===
        fixtureTree('after', 'extension')['src/contract.json'],
    }).toEqual({
      status: 1,
      stderr:
        'Left unchanged:\n  test/contract.json: has neither "formatVersion" nor "schemaVersion", so no release of Prisma wrote it; the script leaves it alone. Emit it again with `prisma contract emit`, or restore it from version control\n',
      upgraded: true,
    });
  });
});
