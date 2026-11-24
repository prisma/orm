import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { computeStorageHash } from '@internal/contract/hashing';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFixture,
  copyInto,
  editFile,
  fixturesDir,
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
const MONGO_EARLIER_SNAPSHOT_HASH =
  'fb3df4c4899adcd423e9b75164870cef1be789fe6871a24b7fda64e707f324ad';
const SQL_SNAPSHOT_HASH = '10cdd020e0f2e31ec61d010c58b77fbed5fae1c1919e21839ba1d2bb82b6aef6';

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
  it('names the emitted contract when its content does not give the storage hash its snapshot is named by', () => {
    const root = copyFixture('before');
    editFile(root, MONGO_CONTRACT, (text) => text.replace('"timestamp_1"', '"timestamp_edited"'));
    const edited = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stdout: run.stdout, tree: readTree(root) }).toEqual({
      status: 1,
      stdout: '',
      tree: edited,
    });
    expect(run.stderr).toMatch(
      new RegExp(
        `^Changed no file, because:\\n  ${MONGO_CONTRACT}: its storage hash "${MONGO_STORAGE_HASH}" is not the one its content gives, [0-9a-f]{64}\\. The file was edited by hand or comes from another release: restore it from version control, or emit it again, and run the script again\\n$`,
      ),
    );
  });

  it('names a SQL snapshot whose content does not give its storage hash and directory name', () => {
    const root = copyFixture('before', 'postgres-app');
    const snapshot = `migrations/snapshots/${SQL_SNAPSHOT_HASH}/contract.json`;
    editFile(root, snapshot, (text) => text.replaceAll('"nullable":true', '"nullable":false'));
    const edited = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stdout: run.stdout, tree: readTree(root) }).toEqual({
      status: 1,
      stdout: '',
      tree: edited,
    });
    expect(run.stderr).toContain(
      `  ${snapshot}: its storage hash "${SQL_SNAPSHOT_HASH}" is not the one its content gives,`,
    );
    expect(run.stderr).toContain(
      `its snapshot directory is named ${SQL_SNAPSHOT_HASH}, which is not the storage hash its content gives,`,
    );
  });

  it('names a MongoDB snapshot whose stored storage hash is neither its directory name nor a hash of its content', () => {
    const root = copyFixture('before', 'mongo-app');
    const snapshot = `migrations/snapshots/${MONGO_STORAGE_HASH}/contract.json`;
    editFile(root, snapshot, (text) => text.replace(MONGO_STORAGE_HASH, 'b'.repeat(64)));
    const edited = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stdout: run.stdout, tree: readTree(root) }).toEqual({
      status: 1,
      stdout: '',
      tree: edited,
    });
    expect(run.stderr).toContain(
      `  ${snapshot}: its storage hash "${'b'.repeat(64)}" is not the one its content gives,`,
    );
  });

  it('names a contract that is not a snapshot when a migration names its hash', () => {
    const root = copyFixture('before', 'mongo-app');
    mkdirSync(join(root, 'test'));
    writeFileSync(
      join(root, 'test/contract.json'),
      readFileSync(join(root, MONGO_CONTRACT.replace('mongo-app/', '')), 'utf8').replace(
        '"timestamp_1"',
        '"timestamp_edited"',
      ),
    );
    const edited = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, tree: readTree(root) }).toEqual({ status: 1, tree: edited });
    expect(run.stderr).toContain(
      `  test/contract.json: its storage hash "${MONGO_STORAGE_HASH}" is not the one its content gives,`,
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

describe('a MongoDB snapshot whose content an earlier upgrade step rewrote, keeping its hash', () => {
  const root = copyFixture('before', 'mongo-app');
  const snapshot = `migrations/snapshots/${MONGO_EARLIER_SNAPSHOT_HASH}/contract.json`;
  editFile(root, snapshot, (text) =>
    text.replace('"name":"timestamp_1"', '"name":"timestamp_named_by_a_step"'),
  );
  const naming = Object.keys(readTree(root)).filter((path) =>
    readTree(root)[path]?.includes(MONGO_EARLIER_SNAPSHOT_HASH),
  );
  const contentHash = mongoStorageHashOf(join(root, snapshot));
  const run = runScript(root);
  const tree = readTree(root);

  it('takes the storage hash its content gives, and so does every file that names it', () => {
    expect(naming.length).toBeGreaterThan(2);
    expect({
      status: run.status,
      stderr: run.stderr,
      stillNaming: Object.keys(tree).filter((path) =>
        tree[path]?.includes(MONGO_EARLIER_SNAPSHOT_HASH),
      ),
      snapshotStores: mongoStorageHashOf(
        join(root, `migrations/snapshots/${contentHash}/contract.json`),
        'stored',
      ),
      renamedNaming: naming
        .map((path) => path.replace(MONGO_EARLIER_SNAPSHOT_HASH, contentHash))
        .every((path) => tree[path]?.includes(contentHash)),
    }).toEqual({
      status: 0,
      stderr: '',
      stillNaming: [],
      snapshotStores: contentHash,
      renamedNaming: true,
    });
  });

  it('is listed in the report', () => {
    expect(run.stdout).toContain(
      `MongoDB snapshots whose content an earlier upgrade step rewrote without changing their storage hash. They now have the storage hash their content gives, and so does every file that names them:\n  ${snapshot} (${MONGO_EARLIER_SNAPSHOT_HASH} -> ${contentHash})\n`,
    );
  });

  it('changes nothing on a second run', () => {
    expect(runScript(root)).toEqual({ status: 0, stdout: NOTHING_CHANGED, stderr: '' });
  });
});

describe('a contract that is not a snapshot, whose hashes nothing in the project names', () => {
  it('is left unchanged and reported when its hash is not the one its content gives, and the rest of the project is upgraded', () => {
    const root = copyFixture('before');
    const fixture = 'mongo-app/test/fixtures/hand-made.json';
    mkdirSync(join(root, 'mongo-app/test/fixtures'), { recursive: true });
    const text = readFileSync(join(root, MONGO_CONTRACT), 'utf8').replace(
      MONGO_STORAGE_HASH,
      'c'.repeat(64),
    );
    writeFileSync(join(root, fixture), text);
    const run = runScript(root);
    const { [fixture]: left, ...rest } = readTree(root);
    expect({ status: run.status, left, rest }).toEqual({
      status: 1,
      left: text,
      rest: fixtureTree('after'),
    });
    expect(run.stderr).toMatch(
      new RegExp(
        `^Left unchanged:\\n  ${fixture}: its storage hash "${'c'.repeat(64)}" is not the one its content gives, ${MONGO_STORAGE_HASH}\\. It is not a snapshot, and no migration, ref or snapshot names its hashes, so the script leaves it alone\\. If Prisma emits it, emit it again with \`prisma contract emit\`; otherwise set its storage and profile hashes to [0-9a-f]{64} and [0-9a-f]{64}, the hashes its content gives\\n$`,
      ),
    );
  });
});

describe("an application's copy of an extension's migrations, which has no snapshot of the contracts in between", () => {
  function withExtensionCopy(side: 'before' | 'after'): string {
    const root = copyFixture(side, 'postgres-app');
    const migrations = join(fixturesDir, side, 'extension/migrations');
    for (const entry of readdirSync(migrations))
      if (entry !== 'snapshots')
        copyInto(root, side, `extension/migrations/${entry}`, `migrations/pgvector/${entry}`);
    const head: string = JSON.parse(readFileSync(join(migrations, 'refs/head.json'), 'utf8')).hash;
    copyInto(root, side, `extension/migrations/snapshots/${head}`, `migrations/snapshots/${head}`);
    return root;
  }

  it('is reported with the old hashes, since the script cannot tell their new values', () => {
    const run = runScript(withExtensionCopy('before'));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      '  migrations/pgvector/20261029T1342_declare_vector_extension/migration.json: its "from", ',
    );
  });

  it('is accepted once `prisma contract emit` has written it again from the upgraded extension', () => {
    const root = withExtensionCopy('after');
    const tree = readTree(root);
    expect({ run: runScript(root), tree: readTree(root) }).toEqual({
      run: { status: 0, stdout: NOTHING_CHANGED, stderr: '' },
      tree,
    });
  });
});

describe("an application whose snapshot store already holds the extension's contract at its new hash, written by `prisma contract emit`", () => {
  const OLD = 'e4ab7d4329212a72d8e440fd7bf95a03e5c861e1d304dce1025b0fcaa1910d15';
  const NEW = 'd2c19e6a88b5b89e23e8ce4863844d40813bcf7712509e631d7cd29d405af27b';
  const withoutNewerCapabilities = (text: string) =>
    text
      .replace('"insertOnConflictTarget":true,', '')
      .replace('"jsonAgg":true,"jsonAggWithoutTruncation":true,', '')
      .replace('"outerReferencesInDerivedTables":true,', '');

  function emittedProject(): string {
    const root = copyFixture('before', 'postgres-app');
    const migrations = join(fixturesDir, 'after', 'extension/migrations');
    for (const entry of readdirSync(migrations))
      if (entry !== 'snapshots')
        copyInto(root, 'after', `extension/migrations/${entry}`, `migrations/pgvector/${entry}`);
    copyInto(root, 'after', `extension/migrations/snapshots/${NEW}`, `migrations/snapshots/${NEW}`);
    editFile(root, `migrations/snapshots/${NEW}/contract.json`, withoutNewerCapabilities);
    copyInto(
      root,
      'before',
      `extension/migrations/snapshots/${OLD}`,
      `migrations/snapshots/${OLD}`,
    );
    return root;
  }

  it('keeps the emitted snapshot unchanged, removes the old one, and reports both', () => {
    const root = emittedProject();
    const emitted = Object.fromEntries(
      Object.entries(readTree(root)).filter(([path]) => path.includes(NEW)),
    );
    const run = runScript(root);
    const tree = readTree(root);
    expect({
      status: run.status,
      stderr: run.stderr,
      emitted: Object.fromEntries(Object.entries(tree).filter(([path]) => path.includes(NEW))),
      old: Object.keys(tree).filter((path) => path.includes(OLD)),
      app: Object.fromEntries(
        Object.entries(tree).filter(
          ([path]) => !path.startsWith('migrations/pgvector/') && !path.includes(NEW),
        ),
      ),
    }).toEqual({
      status: 0,
      stderr: '',
      emitted,
      old: [],
      app: fixtureTree('after', 'postgres-app'),
    });
    expect(run.stdout).toContain(
      `Snapshot directories whose new name already held a snapshot with the same storage hash, which \`prisma contract emit\` wrote with this release. The script kept that snapshot unchanged and removed the old directory:\n  migrations/snapshots/${OLD} (kept migrations/snapshots/${NEW}/)\n`,
    );
    expect(runScript(root)).toEqual({ status: 0, stdout: NOTHING_CHANGED, stderr: '' });
  });

  it('is refused when the directory with the new name holds no contract that gives that storage hash', () => {
    const root = emittedProject();
    rmSync(join(root, `migrations/snapshots/${NEW}/contract.json`));
    const edited = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stdout: run.stdout, tree: readTree(root) }).toEqual({
      status: 1,
      stdout: '',
      tree: edited,
    });
    expect(run.stderr).toContain(
      `  migrations/snapshots/${OLD}: becomes snapshots/${NEW}/, which already exists with other content.`,
    );
  });
});

describe('a snapshot directory with the new name whose contract gives another storage hash', () => {
  const root = copyFixture('before', 'mongo-app');
  const earlier = `migrations/snapshots/${MONGO_EARLIER_SNAPSHOT_HASH}`;
  const newHash = mongoStorageHashOf(join(root, earlier, 'contract.json'));
  const occupied = `migrations/snapshots/${newHash}`;
  mkdirSync(join(root, occupied));
  writeFileSync(
    join(root, occupied, 'contract.json'),
    readFileSync(join(root, earlier, 'contract.json'), 'utf8')
      .replace('"name":"timestamp_1"', '"name":"timestamp_named_by_a_step"')
      .replace(MONGO_EARLIER_SNAPSHOT_HASH, newHash),
  );
  const edited = readTree(root);
  const run = runScript(root);

  it('is refused, keeping both directories', () => {
    expect(mongoStorageHashOf(join(root, occupied, 'contract.json'))).not.toBe(newHash);
    expect({ status: run.status, stdout: run.stdout, tree: readTree(root) }).toEqual({
      status: 1,
      stdout: '',
      tree: edited,
    });
    expect(run.stderr).toContain(
      `  ${earlier}: becomes snapshots/${newHash}/, which already exists with other content.`,
    );
  });
});

function mongoStorageHashOf(path: string, which: 'content' | 'stored' = 'content'): string {
  const contract = JSON.parse(readFileSync(path, 'utf8'));
  const { storageHash, ...storage } = contract.storage;
  if (which === 'stored') return storageHash;
  return computeStorageHash({
    target: contract.target,
    targetFamily: contract.targetFamily,
    storage,
    ...mongoContractCanonicalizationHooks,
  });
}
