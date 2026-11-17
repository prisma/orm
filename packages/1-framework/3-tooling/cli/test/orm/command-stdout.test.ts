import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'pathe';
import { describe, expect, it } from 'vitest';

const ORM_COMMANDS_DIR = join(import.meta.dirname, '../../src/orm');

const EMPTY_STDOUT = [
  /stdout:\s*\(\)\s*=>\s*\(?\s*\[\s*\]/,
  /stdout\s*(?::\s*(?:function\s*)?)?\([^)]*\)\s*(?:=>\s*)?\{\s*return\s*\[\s*\]/,
];

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const sources = sourceFiles(ORM_COMMANDS_DIR).map((path) => ({
  path: relative(ORM_COMMANDS_DIR, path),
  text: readFileSync(path, 'utf-8'),
}));

describe('ORM command stdout', () => {
  it('reads every command source', () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map((source) => source.path)).toEqual(
      expect.arrayContaining(['migration/list.ts', 'migrate.ts', 'db/sign.ts']),
    );
  });

  it('says why when a command has no data lines', () => {
    const silent = sources
      .filter((source) => EMPTY_STDOUT.some((pattern) => pattern.test(source.text)))
      .map((source) => source.path);

    expect(silent).toEqual([]);
  });

  it('declares no data lines only in the commands that have none', () => {
    const declared = sources.flatMap((source) =>
      Array.from(source.text.matchAll(/noDataLines\(/g), () => source.path),
    );

    expect(declared.sort()).toEqual([
      'db/init.ts',
      'db/schema.ts',
      'db/update.ts',
      'db/verify.ts',
      'db/verify.ts',
      'ref/delete.ts',
    ]);
  });

  it.each([
    ['an arrow returning an empty list', 'stdout: () => [],'],
    ['an arrow returning a parenthesized empty list', 'stdout: () => ([]),'],
    ['a method returning an empty list', 'stdout() { return []; },'],
    ['a function returning an empty list', 'stdout: function () { return []; },'],
  ])('recognizes %s as no data lines', (_name, text) => {
    expect(EMPTY_STDOUT.some((pattern) => pattern.test(text))).toBe(true);
  });
});
