import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFixture,
  copyInto,
  editFile,
  fixtureTree,
  readTree,
  removeWorkDirs,
  runScript,
  runScriptStoppedBefore,
} from './test-helpers';

afterAll(removeWorkDirs);

const STOPPED = 70;
const OLD_HEAD = '6c26c85a74b9429d6bb929df0c3e5035352fdb4cc2ee0e711a7a215e490041b1';
const NEW_HEAD = '345059ad82748235deff6cf12d40690f582d2420e63dccaf41c1c3fe654777b4';
const BACKFILL = 'mongo-app/migrations/app/20260513T0508_backfill_product_status';
const MONGO_EARLIER_SNAPSHOT = 'fb3df4c4899adcd423e9b75164870cef1be789fe6871a24b7fda64e707f324ad';

const stops = [
  { write: 'a migration.json', pattern: String.raw`^rename .*/migration\.json$`, skip: 3 },
  { write: 'a ref file', pattern: String.raw`^rename .*/refs/[^/]+\.json$`, skip: 1 },
  {
    write: "a snapshot's contract.json",
    pattern: String.raw`^rename .*/snapshots/[0-9a-f]{64}/contract\.json$`,
    skip: 2,
  },
  {
    write: "a snapshot's contract.d.ts",
    pattern: String.raw`^rename .*/snapshots/[0-9a-f]{64}/contract\.d\.ts$`,
    skip: 1,
  },
  {
    write: 'an emitted contract',
    pattern: String.raw`^rename .*/src/(prisma/)?contract\.json$`,
    skip: 1,
  },
  {
    write: "an emitted contract's contract.d.ts",
    pattern: String.raw`^rename .*/src/(prisma/)?contract\.d\.ts$`,
    skip: 0,
  },
  { write: 'a migration.ts', pattern: String.raw`^rename .*/migration\.ts$`, skip: 2 },
  {
    write: 'a snapshot directory rename',
    pattern: '^rename .*/snapshots/[0-9a-f]{64}$',
    skip: 2,
  },
] as const;

describe('a run stopped just before it writes', () => {
  it.each(stops)('$write is finished by the next run', ({ pattern, skip }) => {
    const root = copyFixture('before');
    const stopped = runScriptStoppedBefore(root, pattern, skip);
    const partial = JSON.stringify(readTree(root));
    expect({
      stopped: stopped.status,
      wroteSome: partial !== JSON.stringify(fixtureTree('before')),
      wroteAll: partial === JSON.stringify(fixtureTree('after')),
    }).toEqual({ stopped: STOPPED, wroteSome: true, wroteAll: false });
    expect({ status: runScript(root).status, tree: readTree(root) }).toEqual({
      status: 0,
      tree: fixtureTree('after'),
    });
  });

  it('the ops.json beside a migration.json it already rewrote is finished by the next run', () => {
    const root = copyFixture('before');
    const stopped = runScriptStoppedBefore(root, String.raw`^rename .*/ops\.json$`);
    const partial = readTree(root);
    expect({
      stopped: stopped.status,
      migration:
        partial[`${BACKFILL}/migration.json`] ===
        fixtureTree('after')[`${BACKFILL}/migration.json`],
      ops: partial[`${BACKFILL}/ops.json`] === fixtureTree('before')[`${BACKFILL}/ops.json`],
    }).toEqual({ stopped: STOPPED, migration: true, ops: true });
    expect({ status: runScript(root).status, tree: readTree(root) }).toEqual({
      status: 0,
      tree: fixtureTree('after'),
    });
  });
});

describe('a run stopped while it removes a snapshot directory that another one already holds', () => {
  it.each([
    String.raw`^rename .*/\.${OLD_HEAD}\.contract-hash-inputs-removed$`,
    String.raw`^remove .*/\.${OLD_HEAD}\.contract-hash-inputs-removed$`,
  ])('before %s is finished by the next run', (pattern) => {
    const root = copyFixture('before');
    const head = `postgres-app/migrations/snapshots/${NEW_HEAD}`;
    copyInto(root, 'after', head, head);
    expect(runScriptStoppedBefore(root, pattern).status).toBe(STOPPED);
    expect({ status: runScript(root).status, tree: readTree(root) }).toEqual({
      status: 0,
      tree: fixtureTree('after'),
    });
  });
});

describe('a run stopped before it renames a MongoDB snapshot an earlier upgrade step rewrote', () => {
  it('is finished by the next run', () => {
    const edit = (root: string) =>
      editFile(root, `migrations/snapshots/${MONGO_EARLIER_SNAPSHOT}/contract.json`, (text) =>
        text.replace('"name":"timestamp_1"', '"name":"timestamp_named_by_a_step"'),
      );
    const reference = copyFixture('before', 'mongo-app');
    edit(reference);
    expect(runScript(reference).status).toBe(0);

    const root = copyFixture('before', 'mongo-app');
    edit(root);
    expect(runScriptStoppedBefore(root, '^rename .*/snapshots/[0-9a-f]{64}$').status).toBe(STOPPED);
    expect({ status: runScript(root).status, tree: readTree(root) }).toEqual({
      status: 0,
      tree: readTree(reference),
    });
  });
});

describe('files that start with a byte order mark', () => {
  it('keep exactly one after the script rewrites them', () => {
    const bom = '﻿';
    const marked = (path: string) => /\.(json|ts)$/.test(path);
    const root = copyFixture('before');
    for (const path of Object.keys(readTree(root)))
      if (marked(path)) editFile(root, path, (text) => bom + text);
    const run = runScript(root);
    expect({ status: run.status, stderr: run.stderr, tree: readTree(root) }).toEqual({
      status: 0,
      stderr: '',
      tree: Object.fromEntries(
        Object.entries(fixtureTree('after')).map(([path, text]) => [
          path,
          marked(path) ? bom + text : text,
        ]),
      ),
    });
    expect(runScript(root).status).toBe(0);
  });
});
