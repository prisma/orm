import { spawnSync } from 'node:child_process';
import { lstatSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appScript,
  copyFixture,
  expectedTree,
  makeWorkDir,
  POSTGRES_EXTENSION_SPACE_SUMMARY,
  type Run,
  readTree,
  removeWorkDirs,
  runScript,
  upgrade,
  upgradeSummary,
} from './test-helpers';

afterAll(removeWorkDirs);

describe('migrations outside a directory named migrations', () => {
  const summaries: Record<string, string> = {
    'db-migrations': upgradeSummary('Rewrote 5 files and renamed 1 snapshot directory.', [
      [
        '55ea5bec09638773a4537b126c44a94c3c7714adacbc44298605dcf6d850c201',
        'd3a277a78b83a532f1ce006d0b7b5e059cc9d15a440922acd9df1055156afbf2',
      ],
    ]),
    'two-migration-roots': upgradeSummary('Rewrote 10 files and renamed 2 snapshot directories.', [
      [
        '3fa48ebe1f86cf8587c9887b33f8fd0b38caf19703ca83aa25657456e12bd675',
        '7b90ed66186d9fc6824cca0d0cc7b957bb47de724164cfe891ea0b8477641664',
      ],
      [
        '55ea5bec09638773a4537b126c44a94c3c7714adacbc44298605dcf6d850c201',
        'd3a277a78b83a532f1ce006d0b7b5e059cc9d15a440922acd9df1055156afbf2',
      ],
    ]),
  };
  for (const name of ['db-migrations', 'two-migration-roots']) {
    it(`upgrades ${name}`, () => {
      const run = upgrade(name);
      expect({
        status: run.status,
        stdout: run.stdout,
        stderr: run.stderr,
        tree: readTree(run.root),
      }).toEqual({
        status: 0,
        stdout: summaries[name],
        stderr: '',
        tree: expectedTree(name, 'after'),
      });
    });
  }
});

describe('a project whose directories are symbolic links', () => {
  const name = 'postgres-extension-space';
  const upgraded = { status: 0, stdout: POSTGRES_EXTENSION_SPACE_SUMMARY, stderr: '' };
  const outcome = (run: Run, tree: Record<string, string>) => ({
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    tree,
  });

  it('upgrades a migrations directory that is a link to a sibling directory', () => {
    const root = copyFixture(name, 'before');
    const elsewhere = makeWorkDir(`data-type-in-contract-${name}-elsewhere-`);
    renameSync(join(root, 'migrations'), join(elsewhere, 'migrations'));
    symlinkSync(join(elsewhere, 'migrations'), join(root, 'migrations'), 'dir');
    const run = runScript(root);
    expect({
      ...outcome(run, { ...readTree(root), ...readTree(elsewhere) }),
      linkKept: lstatSync(join(root, 'migrations')).isSymbolicLink(),
    }).toEqual({ ...upgraded, tree: expectedTree(name, 'after'), linkKept: true });
  });

  it('upgrades a directory reachable through a link and through its own path once', () => {
    const root = copyFixture(name, 'before');
    renameSync(join(root, 'migrations'), join(root, 'db-history'));
    symlinkSync(join(root, 'db-history'), join(root, 'migrations'), 'dir');
    const run = runScript(root);
    const expected = Object.fromEntries(
      Object.entries(expectedTree(name, 'after')).map(([path, content]) => [
        path.replace(/^migrations\//, 'db-history/'),
        content,
      ]),
    );
    expect(outcome(run, readTree(root))).toEqual({ ...upgraded, tree: expected });
  });

  it('stops at a link that points to its own parent', () => {
    const root = copyFixture(name, 'before');
    symlinkSync(join(root, 'migrations'), join(root, 'migrations', 'loop'), 'dir');
    const run = runScript(root);
    expect(outcome(run, readTree(root))).toEqual({
      ...upgraded,
      tree: expectedTree(name, 'after'),
    });
  });
});

describe('the project root', () => {
  it('defaults to the working directory', () => {
    const root = copyFixture('sqlite-defaults', 'before');
    const result = spawnSync(process.execPath, [appScript], { cwd: root, encoding: 'utf8' });
    expect({ status: result.status, tree: readTree(root) }).toEqual({
      status: 0,
      tree: expectedTree('sqlite-defaults', 'after'),
    });
  });
});

describe('a folder with no SQL contract', () => {
  it('says it found no SQL contract under the root, changes nothing and exits 0', () => {
    const root = makeWorkDir('data-type-in-contract-empty-');
    writeFileSync(join(root, 'package.json'), '{ "name": "not-a-prisma-project" }\n');

    const run = runScript(root);

    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(root),
    }).toEqual({
      status: 0,
      stdout: `No SQL contract was found under ${root}; nothing changed.\n`,
      stderr: '',
      tree: { 'package.json': '{ "name": "not-a-prisma-project" }\n' },
    });
  });
});
