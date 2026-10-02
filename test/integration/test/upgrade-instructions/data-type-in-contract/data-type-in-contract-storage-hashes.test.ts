import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFixture,
  expectedTree,
  extensionScript,
  POSTGRES_EXTENSION_SPACE_SUMMARY,
  readTree,
  removeWorkDirs,
  runScript,
  upgrade,
  upgradeSummary,
} from './test-helpers';

afterAll(removeWorkDirs);

describe('a migration.ts that writes hashes as literals', () => {
  const oldHash = '3d2c56a2944685bd21b05bc8a8d73164397df51c014201902932fbe7e80ff1b8';
  const newHash = '4a96b488a4ce92b434e5f7d6607b6435c0955f0d36b0018077045787764240e6';
  const unrelated = 'c'.repeat(64);
  const migrationTs = (hash: string) =>
    [
      'export default class M extends Migration {',
      `  readonly checksum = '${unrelated}';`,
      '  override describe() {',
      `    return { from: '${hash}', to: '${hash}' };`,
      '  }',
      '}',
      '',
    ].join('\n');

  it('replaces every mapped hash and leaves other hashes unchanged', () => {
    const root = copyFixture('extension-package', 'before');
    const path = join(root, 'migrations', '20260601T0000_install_vector_extension', 'migration.ts');
    writeFileSync(path, migrationTs(oldHash));
    const run = runScript(root, extensionScript);
    expect({ status: run.status, migrationTs: readFileSync(path, 'utf8') }).toEqual({
      status: 0,
      migrationTs: migrationTs(newHash),
    });
  });
});

describe('a snapshot directory that already holds the new hash', () => {
  it('stops when its content differs, changes no file and exits 1', () => {
    const run = upgrade('snapshot-collision');
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'migrations/snapshots/d3a277a78b83a532f1ce006d0b7b5e059cc9d15a440922acd9df1055156afbf2: snapshot directory already exists with different content\n',
      tree: expectedTree('snapshot-collision', 'before'),
    });
  });

  it('removes the old directory when the content is the same', () => {
    const run = upgrade('snapshot-already-present');
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 1 file and renamed 1 snapshot directory.', [
        [
          '55ea5bec09638773a4537b126c44a94c3c7714adacbc44298605dcf6d850c201',
          'd3a277a78b83a532f1ce006d0b7b5e059cc9d15a440922acd9df1055156afbf2',
        ],
      ]),
      stderr: '',
      tree: expectedTree('snapshot-already-present', 'after'),
    });
  });
});

describe('a snapshot whose stored hash does not recompute', () => {
  it('rehashes it from content, says so and rewrites everything that names it', () => {
    const stale = 'a'.repeat(64);
    const run = upgrade('stale-hash');
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: [
        `migrations/snapshots/${stale}/contract.json: stored hash did not recompute; rehashed from content\n`,
        upgradeSummary('Rewrote 3 files and renamed 1 snapshot directory.', [
          [stale, 'a9cae1d6a356a52a11343d60bde0357c78701cfce9fdae926f29c9e2c19b1a04'],
        ]),
      ].join(''),
      stderr: '',
      tree: expectedTree('stale-hash', 'after'),
    });
  });
});

describe('an emitted contract edited by hand after its last snapshot', () => {
  it('writes the same new storage hash into contract.json and contract.d.ts', () => {
    const root = copyFixture('postgres-extension-space', 'before');
    const path = join(root, 'prisma/contract.json');
    const contract = JSON.parse(readFileSync(path, 'utf8'));
    contract.storage.namespaces.public.entries.table.post.columns.note = {
      codecId: 'pg/text@1',
      nativeType: 'text',
      nullable: true,
    };
    writeFileSync(path, JSON.stringify(contract, null, 2));
    const run = runScript(root);
    const upgraded = JSON.parse(readFileSync(path, 'utf8'));
    const dtsHash = /StorageHashBase<'([0-9a-f]{64})'>/.exec(
      readFileSync(join(root, 'prisma/contract.d.ts'), 'utf8'),
    )?.[1];
    expect({ status: run.status, stdout: run.stdout, dtsHash }).toEqual({
      status: 0,
      stdout: `prisma/contract.json: stored hash did not recompute; rehashed from content\n${POSTGRES_EXTENSION_SPACE_SUMMARY}`,
      dtsHash: upgraded.storage.storageHash,
    });
  });
});
