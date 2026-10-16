import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALREADY_IN_NEW_FORM,
  copyFixture,
  expectedTree,
  makeWorkDir,
  NEW_HASH,
  OLD_HASH,
  readTree,
  removeWorkDirs,
  runScript,
} from './test-helpers';

afterAll(removeWorkDirs);

describe('a SQLite project emitted by the previous release', () => {
  it('becomes the project this release emits, with every hash that follows', () => {
    const run = runScript(copyFixture('sqlite-project', 'before'));
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: [
        'Rewrote 5 files and renamed 1 snapshot directory. Storage hashes changed (old -> new):',
        `  ${OLD_HASH} -> ${NEW_HASH}`,
        '',
      ].join('\n'),
      stderr: '',
      tree: expectedTree('sqlite-project', 'after'),
    });
  });

  it('is left unchanged by a second run', () => {
    const first = runScript(copyFixture('sqlite-project', 'before'));
    const second = runScript(first.root);
    expect({ status: second.status, stdout: second.stdout, tree: readTree(second.root) }).toEqual({
      status: 0,
      stdout: ALREADY_IN_NEW_FORM,
      tree: expectedTree('sqlite-project', 'after'),
    });
  });

  it('finishes the upgrade when a run left a temporary file behind', () => {
    const root = copyFixture('sqlite-project', 'before');
    const leftover = join(root, 'src/prisma/.contract.json.data-type-values-tmp');
    writeFileSync(leftover, 'partial');
    const run = runScript(root);
    expect({ status: run.status, tree: readTree(run.root) }).toEqual({
      status: 0,
      tree: expectedTree('sqlite-project', 'after'),
    });
  });
});

describe('a project this release emitted', () => {
  it('is left unchanged', () => {
    const run = runScript(copyFixture('sqlite-project', 'after'));
    expect({ status: run.status, stdout: run.stdout, tree: readTree(run.root) }).toEqual({
      status: 0,
      stdout: ALREADY_IN_NEW_FORM,
      tree: expectedTree('sqlite-project', 'after'),
    });
  });
});

describe('a project with no SQLite contract', () => {
  it('says so and changes nothing, leaving a Postgres contract as it is', () => {
    const root = makeWorkDir('data-type-values-postgres-');
    const contract = `${JSON.stringify(
      {
        targetFamily: 'sql',
        target: 'postgres',
        storage: {
          storageHash: 'a'.repeat(64),
          namespaces: {
            public: {
              entries: {
                table: {
                  t: {
                    columns: {
                      at: {
                        codecId: 'sqlite/datetime@1',
                        dataType: 'sqlite/text',
                        nullable: false,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`;
    writeFileSync(join(root, 'contract.json'), contract);
    const run = runScript(root);
    expect({ status: run.status, stdout: run.stdout, tree: readTree(run.root) }).toEqual({
      status: 0,
      stdout: `No SQLite contract was found under ${root}; nothing changed.\n`,
      tree: { 'contract.json': contract },
    });
  });
});

describe('a project the script cannot finish', () => {
  it('stops before writing when the new snapshot directory holds something else', () => {
    const root = copyFixture('sqlite-project', 'before');
    const taken = join(root, 'migrations/snapshots', NEW_HASH);
    mkdirSync(taken);
    writeFileSync(join(taken, 'contract.json'), '{}\n');
    const before = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stderr: run.stderr, tree: readTree(root) }).toEqual({
      status: 1,
      stderr: `migrations/snapshots/${NEW_HASH}: snapshot directory already exists with different content\n`,
      tree: before,
    });
  });

  it('stops before writing when a migration.json is not JSON', () => {
    const root = copyFixture('sqlite-project', 'before');
    const path = join(root, 'migrations/app/20260101T0000_initial/migration.json');
    writeFileSync(path, '{');
    const before = readTree(root);
    const run = runScript(root);
    expect({ status: run.status, stderr: run.stderr, tree: readTree(root) }).toEqual({
      status: 1,
      stderr: 'migrations/app/20260101T0000_initial/migration.json: not valid JSON\n',
      tree: before,
    });
  });

  it('refuses an unknown option', () => {
    const run = runScript(makeWorkDir('data-type-values-options-'), ['--data-type']);
    expect({ status: run.status, stderr: run.stderr }).toEqual({
      status: 1,
      stderr: '--data-type: unknown option\n',
    });
  });
});

describe('the fixture', () => {
  it('keeps a text default that reads like an instant as written', () => {
    const contract = JSON.parse(
      readFileSync(
        join(copyFixture('sqlite-project', 'after'), 'src/prisma/contract.json'),
        'utf8',
      ),
    );
    expect(
      contract.storage.namespaces.__unbound__.entries.table.events.columns.note.default,
    ).toEqual({ kind: 'literal', value: '2024-01-01T00:00:00Z' });
  });
});
