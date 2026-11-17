import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALREADY_IN_NEW_FORMAT,
  appScript,
  copyFixture,
  expectedTree,
  extensionScript,
  POSTGRES_EXTENSION_SPACE_SUMMARY,
  type Run,
  readTree,
  removeWorkDirs,
  runScript,
  upgrade,
  upgradeSummary,
} from './test-helpers';

afterAll(removeWorkDirs);

describe('a Postgres project with an extension space and three snapshots', () => {
  const run = upgrade('postgres-extension-space');
  const tree = readTree(run.root);
  const expected = expectedTree('postgres-extension-space', 'after');

  it('exits 0 and prints the files, snapshot directories and storage hashes it changed', () => {
    expect({ status: run.status, stdout: run.stdout, stderr: run.stderr }).toEqual({
      status: 0,
      stdout: POSTGRES_EXTENSION_SPACE_SUMMARY,
      stderr: '',
    });
  });

  it('rewrites the emitted contract and its declarations in the emitter form', () => {
    expect([tree['prisma/contract.json'], tree['prisma/contract.d.ts']]).toEqual([
      expected['prisma/contract.json'],
      expected['prisma/contract.d.ts'],
    ]);
  });

  it('renames every snapshot directory to its new storage hash and rewrites its files', () => {
    const snapshots = (files: Record<string, string>) =>
      Object.entries(files).filter(([path]) => path.startsWith('migrations/snapshots/'));
    expect(snapshots(tree)).toEqual(snapshots(expected));
  });

  it('rewrites from, to and migrationHash of every migration, refs and migration.ts imports', () => {
    const migrations = (files: Record<string, string>) =>
      Object.entries(files).filter(
        ([path]) => path.startsWith('migrations/') && !path.startsWith('migrations/snapshots/'),
      );
    expect(migrations(tree)).toEqual(migrations(expected));
  });

  it('leaves a contract of another family unchanged', () => {
    expect(tree['mongo/contract.json']).toBe(expected['mongo/contract.json']);
  });

  it('produces exactly the expected tree', () => {
    expect(tree).toEqual(expected);
  });
});

describe('a SQLite project with literal defaults', () => {
  it('maps every SQLite codec and rewrites JSON and integer defaults', () => {
    const run = upgrade('sqlite-defaults');
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 5 files and renamed 1 snapshot directory.', [
        [
          '4f20c9f9047b394c4018e94a5e6538e6b4bd30b46604c73d84a4bbd3c12b5b8e',
          '9df4e74652f749c2f4006615728f0bf1b589cb7b30a4159211c4661d0af93109',
        ],
      ]),
      stderr: '',
      tree: expectedTree('sqlite-defaults', 'after'),
    });
  });
});

describe('a JSON column whose default document holds codecId and nativeType', () => {
  const document = { codecId: 'pg/text@1', nativeType: 'text' };
  const documentDts =
    "DefaultLiteralValue<'pg/jsonb@1', { readonly codecId: 'pg/text@1'; readonly nativeType: 'text' }>";
  const outcome = (run: Run) => {
    const tree = readTree(run.root);
    const contract = JSON.parse(tree['prisma/contract.json'] ?? '{}');
    return {
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree,
      document:
        contract.storage.namespaces.public.entries.table.setting.columns.payload.default.value,
      documentInDts: tree['prisma/contract.d.ts']?.includes(documentDts),
    };
  };

  it('leaves a new-format contract unchanged', () => {
    expect(outcome(upgrade('json-default-document', 'after'))).toEqual({
      status: 0,
      stdout: ALREADY_IN_NEW_FORMAT,
      stderr: '',
      tree: expectedTree('json-default-document', 'after'),
      document,
      documentInDts: true,
    });
  });

  it('rewrites the column of an old-format contract and leaves the document as it was', () => {
    expect(outcome(upgrade('json-default-document'))).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 2 files and renamed 0 snapshot directories.', [
        [
          '9badeaec2e56b0e1a85e575799922686ce1915f9087c2d37714def6a92740843',
          'f75e65cd3aace02feb0fdc58bae71be31a681f1728b73c2f05f32ff569a5c934',
        ],
      ]),
      stderr: '',
      tree: expectedTree('json-default-document', 'after'),
      document,
      documentInDts: true,
    });
  });
});

describe('a SQLite project with enums typed by integer codecs', () => {
  it('rewrites their value sets, domain members and defaults as digit text', () => {
    const run = upgrade('sqlite-integer-enums');
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 5 files and renamed 1 snapshot directory.', [
        [
          '73264bd00bf86a4bb8a0a329d31d577149a05b9a267fe7679df22aaa2b7e8dbe',
          '275857ebc0d7a9b0ed6617bb8555fe85616026ac8ff4c25f2da9b67dcd768407',
        ],
      ]),
      stderr: '',
      tree: expectedTree('sqlite-integer-enums', 'after'),
    });
  });
});

describe('a SQLite project with an enum typed by sqlite/json@1', () => {
  it('rewrites its value set, domain members and default as the JSON text of each document', () => {
    const run = upgrade('sqlite-json-enums');
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 5 files and renamed 1 snapshot directory.', [
        [
          '10bb15c2ae8fc4a31a394f5a046eb75fe13e6a78fb4c99b1e0397d038ba25212',
          '66a408f76796db73433c83fbd088c87d168b3800d3f0a737059e3c1f8fd013b0',
        ],
      ]),
      stderr: '',
      tree: expectedTree('sqlite-json-enums', 'after'),
    });
  });
});

describe('an extension package', () => {
  it('rewrites the contract space with the extension copy of the script', () => {
    const run = upgrade('extension-package', 'before', extensionScript);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 5 files and renamed 1 snapshot directory.', [
        [
          '3d2c56a2944685bd21b05bc8a8d73164397df51c014201902932fbe7e80ff1b8',
          '4a96b488a4ce92b434e5f7d6607b6435c0955f0d36b0018077045787764240e6',
        ],
      ]),
      stderr: '',
      tree: expectedTree('extension-package', 'after'),
    });
  });

  it('ships the same script to both audiences', () => {
    expect(readFileSync(extensionScript, 'utf8')).toBe(readFileSync(appScript, 'utf8'));
  });
});

describe('a project already in the new format', () => {
  for (const name of ['postgres-extension-space', 'sqlite-defaults', 'extension-package']) {
    it(`leaves ${name} unchanged and exits 0`, () => {
      const run = upgrade(name, 'after');
      expect({
        status: run.status,
        stdout: run.stdout,
        stderr: run.stderr,
        tree: readTree(run.root),
      }).toEqual({
        status: 0,
        stdout: ALREADY_IN_NEW_FORMAT,
        stderr: '',
        tree: expectedTree(name, 'after'),
      });
    });
  }

  it('leaves a new-format contract unchanged whatever its stored hash', () => {
    const root = copyFixture('sqlite-defaults', 'after');
    const contract = JSON.parse(readFileSync(join(root, 'src/prisma/contract.json'), 'utf8'));
    const { storageHash: _storageHash, ...storage } = contract.storage;
    const placeholder = `${JSON.stringify({ ...contract, storage: { ...storage, storageHash: 'sha256:test-fixture' } }, null, 2)}\n`;
    const withoutHash = `${JSON.stringify({ ...contract, storage }, null, 2)}\n`;
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/placeholder-hash.contract.json'), placeholder);
    writeFileSync(join(root, 'test/no-hash.contract.json'), withoutHash);
    const before = readTree(root);
    const run = runScript(root);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 0,
      stdout: ALREADY_IN_NEW_FORMAT,
      stderr: '',
      tree: before,
    });
  });

  it('is unchanged by a second run', () => {
    const first = upgrade('postgres-extension-space');
    const second = runScript(first.root);
    expect({ status: second.status, stdout: second.stdout, tree: readTree(second.root) }).toEqual({
      status: 0,
      stdout: ALREADY_IN_NEW_FORMAT,
      tree: expectedTree('postgres-extension-space', 'after'),
    });
  });
});
