import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appScript,
  copyFixture,
  extensionScript,
  fixtureTree,
  formatted,
  HASHES,
  initialHashes,
  makeWorkDir,
  postColumns,
  readTree,
  removeWorkDirs,
  runScript,
  type Tree,
  withoutMigration,
  writeTree,
} from './test-helpers';

afterAll(removeWorkDirs);

/** The summary line of every storage.types entry the script removed, per contract it wrote. */
function removedEntries(): readonly string[] {
  const entries = 'Code, Embedding, Slug';
  return [
    'Removed storage.types entries:',
    ...HASHES.map(
      ([, newHash]) => `  migrations/snapshots/${newHash}/contract.json: ${entries}`,
    ).sort(),
    `  prisma/contract.json: ${entries}`,
  ];
}

function summary(files: number, directories: number): string {
  return [
    `Rewrote ${files} files and renamed ${directories} snapshot directories. Storage hashes changed (old -> new):`,
    ...[...HASHES]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([oldHash, newHash]) => `  ${oldHash} -> ${newHash}`),
    ...removedEntries(),
    '',
  ].join('\n');
}

const RESTORE = 'restore the file from version control, or re-emit it, and run the script again';

/** The before fixture with `prisma/contract.json` changed by `change` and stored under `storageHash`, the hash of the changed content, so only the change is wrong. */
function withChangedContract(
  change: (contract: Record<string, unknown>) => void,
  storageHash: string,
): string {
  const root = copyFixture('before');
  const path = join(root, 'prisma/contract.json');
  const contract = JSON.parse(readFileSync(path, 'utf8'));
  change(contract);
  contract.storage.storageHash = storageHash;
  writeFileSync(path, JSON.stringify(contract, null, 2));
  return root;
}

describe('the fixtures', () => {
  it('before the upgrade, store a typeRef on each aliased column', () => {
    const [oldHash] = initialHashes();
    const columns = postColumns(
      JSON.parse(fixtureTree('before')[`migrations/snapshots/${oldHash}/contract.json`] ?? '{}'),
    );
    expect({
      slug: (columns['slug'] as Record<string, unknown>)['typeRef'],
      embedding: (columns['embedding'] as Record<string, unknown>)['typeRef'],
    }).toEqual({ slug: 'Slug', embedding: 'Embedding' });
  });

  it('before the upgrade, store the alias the source declares but no column uses in the latest snapshot and in contract.json', () => {
    const [latestOld, latest] = HASHES[1] ?? [];
    const before = fixtureTree('before');
    const typesOf = (text: string | undefined) =>
      Object.keys(JSON.parse(text ?? '{}').storage?.types ?? {}).sort();
    expect({
      source: before['prisma/contract.prisma']?.includes('Code      = Char(8)'),
      snapshot: typesOf(before[`migrations/snapshots/${latestOld}/contract.json`]),
      emitted: typesOf(before['prisma/contract.json']),
      after: typesOf(fixtureTree('after')[`migrations/snapshots/${latest}/contract.json`]),
    }).toEqual({
      source: true,
      snapshot: ['Code', 'Embedding', 'Slug'],
      emitted: ['Code', 'Embedding', 'Slug'],
      after: [],
    });
  });

  it('keep the vector entry of the pgvector space snapshot', () => {
    const pgvectorHead = JSON.parse(
      fixtureTree('after')['migrations/pgvector/refs/head.json'] ?? '{}',
    );
    const snapshot = `migrations/snapshots/${pgvectorHead.hash}/contract.json`;
    expect({
      before: fixtureTree('before')[snapshot],
      after: Object.keys(JSON.parse(fixtureTree('after')[snapshot] ?? '{}').storage.types),
    }).toEqual({ before: fixtureTree('after')[snapshot], after: ['vector'] });
  });
});

describe('expand-type-aliases', () => {
  it('writes each alias into its columns, renames the snapshots and rewrites every reference to their hashes', () => {
    const run = runScript(copyFixture('before'));
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: formatted(readTree(run.root)),
    }).toEqual({
      status: 0,
      stdout: summary(7, 2),
      stderr: '',
      tree: fixtureTree('after'),
    });
  });

  it('reads past quotes and braces inside comments in contract.d.ts', () => {
    const comment = "// The column's type comes from the alias\n/* a stray { brace */\n";
    const withComments = (tree: Tree): Tree =>
      Object.fromEntries(
        Object.entries(tree).map(([path, text]) => [
          path,
          path.endsWith('contract.d.ts') ? comment + text : text,
        ]),
      );
    const root = makeWorkDir();
    writeTree(root, withComments(fixtureTree('before')));
    const run = runScript(root);
    expect({ status: run.status, tree: formatted(readTree(run.root)) }).toEqual({
      status: 0,
      tree: withComments(fixtureTree('after')),
    });
  });

  it('points the snapshot imports of each migration.ts at the renamed directories', () => {
    const run = runScript(copyFixture('before'));
    const tree = readTree(run.root);
    const imported = Object.entries(tree)
      .filter(([path]) => path.endsWith('migration.ts'))
      .flatMap(([, text]) => [
        ...text.matchAll(/'\.\.\/\.\.\/(snapshots\/[0-9a-f]{64})\/contract/g),
      ])
      .map((match) => `migrations/${match[1]}/contract.json`);
    expect(imported.length).toBeGreaterThan(0);
    expect(imported.filter((path) => tree[path] === undefined)).toEqual([]);
    expect(new Set(imported)).toEqual(
      new Set(HASHES.map(([, newHash]) => `migrations/snapshots/${newHash}/contract.json`)),
    );
  });

  it('changes nothing in a project that stores no typeRef', () => {
    const run = runScript(copyFixture('after'));
    expect({ status: run.status, stdout: run.stdout, tree: readTree(run.root) }).toEqual({
      status: 0,
      stdout: 'No contract stores a type alias; nothing changed.\n',
      tree: fixtureTree('after'),
    });
  });

  it('finishes an upgrade that stopped after writing a new snapshot directory', () => {
    const root = copyFixture('before');
    const [, newHash] = initialHashes();
    const snapshot = `migrations/snapshots/${newHash}`;
    mkdirSync(join(root, snapshot), { recursive: true });
    for (const name of ['contract.json', 'contract.d.ts'])
      writeFileSync(join(root, snapshot, name), fixtureTree('after')[`${snapshot}/${name}`] ?? '');
    const run = runScript(root);
    expect({ status: run.status, tree: formatted(readTree(root)) }).toEqual({
      status: 0,
      tree: fixtureTree('after'),
    });
  });

  it('stops without changing a file when a new snapshot directory exists with other content', () => {
    const root = copyFixture('before');
    const [, newHash] = initialHashes();
    mkdirSync(join(root, 'migrations/snapshots', newHash), { recursive: true });
    writeFileSync(join(root, 'migrations/snapshots', newHash, 'contract.json'), '{}\n');
    const before = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stderr: run.stderr, tree: readTree(root) }).toEqual({
      status: 1,
      stderr: `migrations/snapshots/${newHash}: snapshot directory already exists with different content\n`,
      tree: before,
    });
  });

  it('stops without changing a file when a snapshot directory is not named after its content', () => {
    const root = copyFixture('before');
    const [oldHash] = initialHashes();
    const misnamed = 'a'.repeat(64);
    renameSync(
      join(root, 'migrations/snapshots', oldHash),
      join(root, 'migrations/snapshots', misnamed),
    );
    const before = readTree(root);
    const run = runScript(root);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 1,
      stdout: '',
      stderr: `migrations/snapshots/${misnamed}/contract.json: the stored storage hash ${misnamed} does not match the contract's content, which hashes to ${oldHash}; restore the file from version control, or re-emit it, and run the script again\n`,
      tree: before,
    });
  });

  it('stops without changing a file when an alias has another codec than the column it types', () => {
    const root = copyFixture('before');
    const path = join(root, 'prisma/contract.json');
    const contract = JSON.parse(readFileSync(path, 'utf8'));
    contract.storage.types.Slug.codecId = 'sql/char@1';
    contract.storage.storageHash =
      'f595fff7dfd2e04940c2521a0a355bfa5007f6e7d1bcc36886108a8eb970f5b3';
    writeFileSync(path, JSON.stringify(contract, null, 2));
    const before = readTree(root);
    const run = runScript(root);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 1,
      stdout: '',
      stderr: [
        'prisma/contract.json: column post.slug has codec sql/varchar@1 and data type pg/varchar, but its type alias Slug has codec sql/char@1 and data type pg/varchar; restore the file from version control, or re-emit it, and run the script again',
        'prisma/contract.json: column post.title has codec sql/varchar@1 and data type pg/varchar, but its type alias Slug has codec sql/char@1 and data type pg/varchar; restore the file from version control, or re-emit it, and run the script again',
        '',
      ].join('\n'),
      tree: before,
    });
  });

  it('stops without changing a file when a column names an alias storage.types does not declare', () => {
    const root = withChangedContract((contract) => {
      delete (contract['storage'] as { types: Record<string, unknown> }).types['Slug'];
    }, 'afa884d64c27b4c8ccabb412a6019d15a119030b48e5fefb04f5168301ecd8b3');
    const before = readTree(root);
    const run = runScript(root);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 1,
      stdout: '',
      stderr: [
        `prisma/contract.json: column post.slug is typed by the type alias "Slug", which storage.types does not declare; ${RESTORE}`,
        `prisma/contract.json: column post.title is typed by the type alias "Slug", which storage.types does not declare; ${RESTORE}`,
        '',
      ].join('\n'),
      tree: before,
    });
  });

  it('stops without changing a file when a column stores both typeRef and typeParams', () => {
    const root = withChangedContract((contract) => {
      (postColumns(contract)['slug'] as Record<string, unknown>)['typeParams'] = { length: 64 };
    }, '22ee6a989e07bf2c5ec874f88b090c37a5b02329ee7ec424f33d87029e0167ea');
    const before = readTree(root);
    const run = runScript(root);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 1,
      stdout: '',
      stderr: `prisma/contract.json: column post.slug stores both typeRef and typeParams; ${RESTORE}\n`,
      tree: before,
    });
  });

  it('stops without changing a file when a contract, migration or ref is not valid JSON', () => {
    const root = copyFixture('before');
    for (const path of [
      'prisma/contract.json',
      'migrations/app/20260201T0000_add_title/migration.json',
      'migrations/app/refs/head.json',
    ])
      writeFileSync(join(root, path), '{');
    const before = readTree(root);
    const run = runScript(root);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 1,
      stdout: '',
      stderr: [
        'migrations/app/20260201T0000_add_title/migration.json: not valid JSON',
        'migrations/app/refs/head.json: not valid JSON',
        'prisma/contract.json: not valid JSON',
        '',
      ].join('\n'),
      tree: before,
    });
  });

  it('keeps the vector entry of a pgvector space snapshot that no migration or ref names', () => {
    const root = copyFixture('before');
    rmSync(join(root, 'migrations/pgvector'), { recursive: true });
    const run = runScript(root);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: formatted(readTree(root)),
    }).toEqual({
      status: 0,
      stdout: summary(7, 2),
      stderr: '',
      tree: withoutMigration(fixtureTree('after'), 'migrations/pgvector'),
    });
  });

  it('refuses an option or a project root that is not a directory, and changes nothing', () => {
    const root = copyFixture('before');
    const missing = join(root, 'missing');
    const usage = 'Usage: node expand-type-aliases.ts [project-root]\n';
    const runs = [runScript('--help'), runScript(missing)].map(({ status, stdout, stderr }) => ({
      status,
      stdout,
      stderr,
    }));
    expect({ runs, tree: readTree(root) }).toEqual({
      runs: [
        { status: 1, stdout: '', stderr: `--help: unknown option\n${usage}` },
        { status: 1, stdout: '', stderr: `${missing}: not a directory\n${usage}` },
      ],
      tree: fixtureTree('before'),
    });
  });

  it('ships the same script for extensions', () => {
    expect(readFileSync(extensionScript, 'utf8')).toBe(readFileSync(appScript, 'utf8'));
  });
});
