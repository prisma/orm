import { cpSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appScript,
  copyFixture,
  extensionScript,
  fixturesDir,
  fixtureTree,
  readTree,
  removeWorkDirs,
  runScript,
  type Tree,
} from './test-helpers';

const HASHES: ReadonlyArray<readonly [string, string]> = [
  [
    '1cc4868e51782f6a87585b26cbfdd83c44f89b973de022f42bfdddf93bce72cb',
    'd52545171b2ee43107e1a619867dde006d83c7ab8d23bc2f4797524c76c3a662',
  ],
  [
    '0afd7bad7a1e491be0530915cb0a910ce38a75e6195e0cf37fd752329d2bb9ab',
    '43d3880fa8b128e29f8a96c203566329c0ed35a2884901cbad49e2633b812f54',
  ],
];

afterAll(removeWorkDirs);

const OLD_DEFAULTS_HASH = 'a086c916bc6bf55a62e34ea3fc3c264634e3a078f3e00e99b0e3a332cd31ecc8';
/** The storage hash `prisma contract emit` of 8.0.0-rc.19 gives the postgres-defaults schema. */
const EMITTED_BY_RC19_HASH = '1dd0420f931282d68277216cdff0dc9059fde0f0e086bbc596cdf32675577e0b';

interface Rc19Form {
  readonly value: unknown;
  readonly stored: unknown;
}

interface Rc19Forms {
  readonly columns: readonly Rc19Form[];
  readonly list: Rc19Form;
  readonly named: Rc19Form;
}

function sampleDefaultsOf(forms: Rc19Forms, side: keyof Rc19Form): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      forms.columns.map((form, index) => [`c${String(index).padStart(2, '0')}`, form[side]]),
    ),
    list: forms.list[side],
    named: forms.named[side],
  };
}

const rc19Forms: Rc19Forms = JSON.parse(
  readFileSync(join(fixturesDir, 'postgres-default-forms/rc19-forms.json'), 'utf8'),
);

function sampleDefaults(text: string): Record<string, unknown> {
  const columns: Record<string, { default: { value: unknown } }> =
    JSON.parse(text).storage.namespaces.public.entries.table.sample.columns;
  return Object.fromEntries(
    Object.entries(columns).map(([name, column]) => [name, column.default.value]),
  );
}

const SNAPSHOT_IMPORT = /^import [^;]*?'\.\.\/\.\.\/snapshots\/[\s\S]*?;\n/gm;

/** A `migration.ts` with its imports in source order, as a formatter leaves them after the script renames the snapshots they name. */
function withSortedImports(text: string): string {
  const imports = text.match(SNAPSHOT_IMPORT) ?? [];
  const source = (statement: string) => /from '([^']*)'/.exec(statement)?.[1] ?? '';
  const sorted = [...imports].sort((a, b) => (source(a) < source(b) ? -1 : 1));
  let index = 0;
  return text.replace(SNAPSHOT_IMPORT, () => sorted[index++] ?? '');
}

function formatted(tree: Tree): Tree {
  return Object.fromEntries(
    Object.entries(tree).map(([path, text]) => [
      path,
      path.endsWith('migration.ts') ? withSortedImports(text) : text,
    ]),
  );
}

function summary(files: number, directories: number): string {
  return [
    `Rewrote ${files} files and renamed ${directories} snapshot directories. Storage hashes changed (old -> new):`,
    ...[...HASHES]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([oldHash, newHash]) => `  ${oldHash} -> ${newHash}`),
    '',
  ].join('\n');
}

function postTableOf(text: string): Record<string, unknown> {
  return JSON.parse(text).storage.namespaces.public.entries.table.post;
}

describe('remove-nocheck', () => {
  it('removes the key, makes waived lists element-nullable, renames the snapshots and rewrites every reference to their hashes', () => {
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

  it('leaves the checks each contract declares as they were', () => {
    const run = runScript(copyFixture('before'));
    expect(postTableOf(readTree(run.root)['prisma/contract.json'] ?? '{}')['checks']).toEqual(
      postTableOf(fixtureTree('before')['prisma/contract.json'] ?? '{}')['checks'],
    );
  });

  it('deletes a membership waiver without making its column element-nullable', () => {
    const [, initialHash] = HASHES[0] ?? [];
    const legacy = (tree: Tree, hash: string | undefined) =>
      (
        postTableOf(tree[`migrations/snapshots/${hash}/contract.json`] ?? '{}')[
          'columns'
        ] as Record<string, unknown>
      )['legacy'];
    const [beforeHash] = HASHES[0] ?? [];
    const { noCheck, ...rest } = legacy(fixtureTree('before'), beforeHash) as Record<
      string,
      unknown
    >;
    expect({ noCheck, after: legacy(fixtureTree('after'), initialHash) }).toEqual({
      noCheck: ['membership'],
      after: rest,
    });
  });

  it('changes nothing in a project that stores no noCheck key', () => {
    const run = runScript(copyFixture('after'));
    expect({ status: run.status, stdout: run.stdout, tree: readTree(run.root) }).toEqual({
      status: 0,
      stdout: 'No contract stores a noCheck key or a default in another form; nothing changed.\n',
      tree: fixtureTree('after'),
    });
  });

  it('finishes an upgrade that stopped after writing a new snapshot directory', () => {
    const root = copyFixture('before');
    const [, newHash] = HASHES[0] ?? [];
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
    const [, newHash] = HASHES[0] ?? [];
    mkdirSync(join(root, 'migrations/snapshots', newHash ?? ''), { recursive: true });
    writeFileSync(join(root, 'migrations/snapshots', newHash ?? '', 'contract.json'), '{}\n');
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
    const [oldHash] = HASHES[0] ?? [];
    const misnamed = 'a'.repeat(64);
    renameSync(
      join(root, 'migrations/snapshots', oldHash ?? ''),
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

  it('makes the row types of a contract.d.ts that the previous release emitted allow null elements', () => {
    const run = runScript(copyFixture('before', 'rc18-emitted'));
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: [
        'Rewrote 2 files and renamed 0 snapshot directories. Storage hashes changed (old -> new):',
        '  0c5fd80b68d670bb15fcc9e86cbb9efba034dc0b0acbd84612ddfbb8ca1037f2 -> 57072494c534223d6da18107bde649add196a5f3d17dd55216541b4efa330fba',
        '',
      ].join('\n'),
      stderr: '',
      tree: fixtureTree('after', 'rc18-emitted'),
    });
  });

  it('writes each PostgreSQL default in the spelling this release stores, as contract emit does, and rewrites every hash that follows', () => {
    const run = runScript(copyFixture('before', 'postgres-defaults'));
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: [
        'Rewrote 4 files and renamed 1 snapshot directory. Storage hashes changed (old -> new):',
        `  ${OLD_DEFAULTS_HASH} -> ${EMITTED_BY_RC19_HASH}`,
        '',
      ].join('\n'),
      stderr: '',
      tree: fixtureTree('after', 'postgres-defaults'),
    });
  });

  it('gives the rewritten snapshot the default and storage hash contract emit gives the schema', () => {
    const snapshot = JSON.parse(
      fixtureTree('after', 'postgres-defaults')[
        `migrations/snapshots/${EMITTED_BY_RC19_HASH}/contract.json`
      ] ?? '{}',
    );
    expect({
      price: snapshot.storage.namespaces.public.entries.table.product.columns.price.default,
      storageHash: snapshot.storage.storageHash,
    }).toEqual({
      price: { kind: 'literal', value: '1.50' },
      storageHash: EMITTED_BY_RC19_HASH,
    });
  });

  it('writes the default of each PostgreSQL data type in the form rc.19 stores, list and named types included', () => {
    const run = runScript(copyFixture('before', 'postgres-default-forms'));
    const tree = readTree(run.root);
    expect({
      status: run.status,
      stderr: run.stderr,
      tree,
      before: sampleDefaults(
        fixtureTree('before', 'postgres-default-forms')['prisma/contract.json'] ?? '{}',
      ),
      defaults: sampleDefaults(tree['prisma/contract.json'] ?? '{}'),
    }).toEqual({
      status: 0,
      stderr: '',
      tree: fixtureTree('after', 'postgres-default-forms'),
      before: sampleDefaultsOf(rc19Forms, 'value'),
      defaults: sampleDefaultsOf(rc19Forms, 'stored'),
    });
  });

  it('stops without changing a file when a default is not a value of its column type', () => {
    const root = copyFixture('before', 'postgres-defaults');
    const path = join(root, 'src/prisma/contract.json');
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('"value": "12:34:00"', '"value": "12:34:00.1234567"'),
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
      stderr:
        'src/prisma/contract.json: namespace public, table product, column opensAt: the default "12:34:00.1234567" is not a value of pg/time (pg/time JSON value must be a time of day, as in "12:34:56": "12:34:00.1234567" has 7 digits after the decimal point, but pg/time holds microseconds, so at most 6. Round it, as in "12:34:56.123456".); choose the value the database stores and run the script again with --default \'public.product.opensAt=<that value as JSON>\'\n',
      tree: before,
    });
  });

  it('skips every directory whose name starts with a dot, such as a worktree under .claude', () => {
    const root = copyFixture('before');
    const hidden = join(root, '.claude/worktrees/feature');
    mkdirSync(hidden, { recursive: true });
    cpSync(join(root, 'prisma'), join(hidden, 'prisma'), { recursive: true });
    cpSync(join(root, 'migrations'), join(hidden, 'migrations'), { recursive: true });
    const hiddenBefore = readTree(hidden);
    const run = runScript(root);
    const { hiddenAfter, rest } = Object.entries(readTree(root)).reduce(
      (split, [path, text]) => {
        if (path.startsWith('.claude/'))
          split.hiddenAfter[path.slice('.claude/worktrees/feature/'.length)] = text;
        else split.rest[path] = text;
        return split;
      },
      { hiddenAfter: {} as Tree, rest: {} as Tree },
    );
    expect({ status: run.status, stdout: run.stdout, hiddenAfter, rest: formatted(rest) }).toEqual({
      status: 0,
      stdout: summary(7, 2),
      hiddenAfter: hiddenBefore,
      rest: fixtureTree('after'),
    });
  });

  it('refuses an option or a project root that is not a directory, and changes nothing', () => {
    const root = copyFixture('before');
    const missing = join(root, 'missing');
    const runs = [runScript('--help'), runScript(missing)].map(({ status, stdout, stderr }) => ({
      status,
      stdout,
      stderr,
    }));
    expect({ runs, tree: readTree(root) }).toEqual({
      runs: [
        {
          status: 1,
          stdout: '',
          stderr:
            '--help: unknown option\nUsage: node remove-nocheck.ts [project-root] [--default <namespace>.<table>.<column>=<JSON value>]...\n',
        },
        {
          status: 1,
          stdout: '',
          stderr: `${missing}: not a directory\nUsage: node remove-nocheck.ts [project-root] [--default <namespace>.<table>.<column>=<JSON value>]...\n`,
        },
      ],
      tree: fixtureTree('before'),
    });
  });

  it('ships the same script for extensions', () => {
    expect(readFileSync(extensionScript, 'utf8')).toBe(readFileSync(appScript, 'utf8'));
  });
});
