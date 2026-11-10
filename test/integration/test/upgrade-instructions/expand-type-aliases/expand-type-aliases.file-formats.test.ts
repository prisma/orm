import { afterAll, describe, expect, it } from 'vitest';
import {
  fixtureTree,
  formatted,
  makeWorkDir,
  readTree,
  removeWorkDirs,
  runScript,
  type Tree,
  writeTree,
} from './test-helpers';

afterAll(removeWorkDirs);

const BYTE_ORDER_MARK = '﻿';

function mapFiles(tree: Tree, change: (text: string, path: string) => string): Tree {
  return Object.fromEntries(Object.entries(tree).map(([path, text]) => [path, change(text, path)]));
}

function withPrefix(tree: Tree, prefix: string): Tree {
  return Object.fromEntries(
    Object.entries(tree).map(([path, text]) => [`${prefix}/${path}`, text]),
  );
}

describe('expand-type-aliases on files in other formats', () => {
  it('leaves a contract under a hidden directory untouched', () => {
    const hidden = withPrefix(fixtureTree('before'), '.claude/worktrees/feature');
    const root = makeWorkDir();
    writeTree(root, { ...fixtureTree('before'), ...hidden });
    const run = runScript(root);
    expect({ status: run.status, tree: formatted(readTree(root)) }).toEqual({
      status: 0,
      tree: { ...fixtureTree('after'), ...hidden },
    });
  });

  it('reads a file that starts with a byte order mark and keeps the mark', () => {
    const marked = new Set([
      'prisma/contract.json',
      'prisma/contract.d.ts',
      'migrations/app/20260201T0000_add_title/migration.json',
      'migrations/app/refs/head.json',
    ]);
    const withMarks = (tree: Tree): Tree =>
      mapFiles(tree, (text, path) => (marked.has(path) ? `${BYTE_ORDER_MARK}${text}` : text));
    const root = makeWorkDir();
    writeTree(root, withMarks(fixtureTree('before')));
    const run = runScript(root);
    expect({ status: run.status, stderr: run.stderr, tree: formatted(readTree(root)) }).toEqual({
      status: 0,
      stderr: '',
      tree: withMarks(fixtureTree('after')),
    });
  });

  it('keeps the CRLF line endings of every file it rewrites, without stray blank lines', () => {
    const root = makeWorkDir();
    writeTree(
      root,
      mapFiles(fixtureTree('before'), (text) => text.replaceAll('\n', '\r\n')),
    );
    const run = runScript(root);
    const tree = readTree(root);
    expect({
      status: run.status,
      stderr: run.stderr,
      filesWithLfEndings: Object.keys(tree).filter((path) => /(?<!\r)\n/.test(tree[path] ?? '')),
      tree: formatted(mapFiles(tree, (text) => text.replaceAll('\r\n', '\n'))),
    }).toEqual({
      status: 0,
      stderr: '',
      filesWithLfEndings: [],
      tree: fixtureTree('after'),
    });
  });
});
