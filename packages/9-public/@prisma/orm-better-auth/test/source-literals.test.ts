import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const targetsRoot = join(sourceRoot, 'targets');
const exportsRoot = join(sourceRoot, 'exports');
const shippedSupports = join(targetsRoot, 'shipped');

const targetNameAtWordStart = /\b(?:pg|postgres|sqlite|mysql|mariadb|mongo)/i;
const targetNameInCamelCase = /(?<=[a-z])(?:P(?i:g|ostgres)|S(?i:qlite)|M(?i:ysql|ariadb|ongo))/;
const codecId = /[\w-]+\/[\w-]+@\d+/;

/** The text of every string and template literal, and every name: variables, properties, property accesses, members, methods and enum members. */
function namesAndLiterals(fileName: string, text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) found.push(node.text);
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true));
  return found;
}

function databaseSpecific(fileName: string, text: string): string[] {
  return namesAndLiterals(fileName, text).filter(
    (item) =>
      targetNameAtWordStart.test(item) || targetNameInCamelCase.test(item) || codecId.test(item),
  );
}

/** Every module specifier the file imports or re-exports from, type-only and dynamic imports included. */
function importedModules(fileName: string, text: string): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true));
  return specifiers;
}

const isUnder = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** Outside src/targets and src/exports, the only module of src/targets a file may import is the list of shipped supports. */
function reachesIntoTargets(file: string, specifier: string): boolean {
  if (!specifier.startsWith('.') || isUnder(file, targetsRoot) || isUnder(file, exportsRoot)) {
    return false;
  }
  const imported = resolve(dirname(file), specifier);
  return isUnder(imported, targetsRoot) && imported !== shippedSupports;
}

const placeholder = (name: string) => ['$', '{', name, '}'].join('');

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('what the main code knows about databases', () => {
  it('finds target names, their prefixes and codec ids in literals and names, and nothing in comments', () => {
    expect(
      databaseSpecific(
        'probe.ts',
        [
          "const a = 'postgres';",
          `const b = \`the ${placeholder('x')} SQLite database\`;`,
          "const c = { 'pg/text@1': 1 };",
          `const d = \`${placeholder('y')} sql/varchar@1\`;`,
          '// mysql and pg/int4@1 in a comment',
          "const e = 'npx auth@latest, @prisma/orm-family-sql/orm-client';",
          'const f = { sqlite: true, other: 1 };',
          "const g = codecId.startsWith('pg/') || name === 'PostgreSQL' || family === 'mongodb';",
          'const h = defaults.mariadb;',
          'const i = { mysql };',
          'interface J { readonly postgresql: boolean; sqliteName(): string }',
          'const k = { mongo() { return 1; } };',
          'enum L { MySql, Other }',
          'const m = isPostgresClient;',
          'const n = isMysqlClient(toMariadb(upgrade));',
        ].join('\n'),
      ),
    ).toEqual([
      'postgres',
      ' SQLite database',
      'pg/text@1',
      ' sql/varchar@1',
      'sqlite',
      'pg/',
      'PostgreSQL',
      'mongodb',
      'mariadb',
      'mysql',
      'postgresql',
      'sqliteName',
      'mongo',
      'MySql',
      'isPostgresClient',
      'isMysqlClient',
      'toMariadb',
    ]);
  });

  it('no literal or name outside src/targets and src/exports is a target name or a codec id', async () => {
    const files = (await sourceFiles()).filter(
      (file) => !isUnder(file, targetsRoot) && !isUnder(file, exportsRoot),
    );
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      for (const item of databaseSpecific(file, await readFile(file, 'utf8'))) {
        offenders.push(`${relative(sourceRoot, file)}: ${item}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds every kind of import and tells the shipped list from the supports themselves', () => {
    expect(
      importedModules(
        'probe.ts',
        [
          "import { a } from './targets/shipped';",
          "import type { B } from './targets/postgres';",
          "export { c } from '../targets/value-kinds';",
          "const d = await import('./targets/sqlite');",
        ].join('\n'),
      ),
    ).toEqual([
      './targets/shipped',
      './targets/postgres',
      '../targets/value-kinds',
      './targets/sqlite',
    ]);
    const file = join(sourceRoot, 'adapter.ts');
    expect(reachesIntoTargets(file, './targets/shipped')).toBe(false);
    expect(reachesIntoTargets(file, './targets/postgres')).toBe(true);
    expect(reachesIntoTargets(join(exportsRoot, 'index.ts'), '../targets/postgres')).toBe(false);
  });

  it('no module outside src/targets and src/exports imports a module of src/targets other than the shipped list', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      for (const specifier of importedModules(file, await readFile(file, 'utf8'))) {
        if (reachesIntoTargets(file, specifier)) {
          offenders.push(`${relative(sourceRoot, file)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/exports holds only re-exports, so its exemption from both checks lets no per-database code in', async () => {
    const files = (await sourceFiles()).filter((file) => isUnder(file, exportsRoot));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(
        file,
        await readFile(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) {
          offenders.push(`${relative(sourceRoot, file)}: ${statement.getText(source)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
