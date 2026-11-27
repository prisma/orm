import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const targetsRoot = join(sourceRoot, 'targets');

const targetName = /\b(?:postgres|sqlite|mysql|mariadb|mongo)\b/i;
const codecId = /[\w-]+\/[\w-]+@\d+/;

function stringLiterals(fileName: string, text: string): string[] {
  const literals: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) literals.push(node.text);
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) literals.push(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true));
  return literals;
}

function databaseSpecificLiterals(fileName: string, text: string): string[] {
  return stringLiterals(fileName, text).filter(
    (literal) => targetName.test(literal) || codecId.test(literal),
  );
}

const placeholder = (name: string) => ['$', '{', name, '}'].join('');

async function mainSourceFiles(): Promise<string[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.startsWith(`${targetsRoot}/`));
}

describe('what the main code knows about databases', () => {
  it('finds target names and codec ids in string and template literals and in property names, and nothing in comments', () => {
    expect(
      databaseSpecificLiterals(
        'probe.ts',
        [
          "const a = 'postgres';",
          `const b = \`the ${placeholder('x')} SQLite database\`;`,
          "const c = { 'pg/text@1': 1 };",
          `const d = \`${placeholder('y')} sql/varchar@1\`;`,
          '// mysql and pg/int4@1 in a comment',
          "const e = 'PostgreSQL, npx auth@latest, @prisma/orm-family-sql/orm-client';",
          'const f = { sqlite: true, other: 1 };',
        ].join('\n'),
      ),
    ).toEqual(['postgres', ' SQLite database', 'pg/text@1', ' sql/varchar@1', 'sqlite']);
  });

  it('no string literal outside src/targets is a target name or a codec id', async () => {
    const files = await mainSourceFiles();
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      for (const literal of databaseSpecificLiterals(file, await readFile(file, 'utf8'))) {
        offenders.push(`${relative(sourceRoot, file)}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
