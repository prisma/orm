import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCES = ['shells.ts', 'levels.ts', 'release-plan.ts'];

/**
 * Every import that runs, as its source text: an `import` or `export … from` that is not type-only
 * (one with an empty list of names included, since it still loads its module), an `import './x'`
 * for its side effects, an `import x = require(…)`, and a dynamic `import(…)`. A type query such as
 * `import('./x').T` loads nothing and is not one.
 */
function runTimeImports(source: string): string[] {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (loadsAtRunTime(node)) found.push(node.getText(file).replace(/;$/, ''));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function loadsAtRunTime(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause === undefined) return true;
    if (clause.isTypeOnly) return false;
    if (clause.name !== undefined) return true;
    const bindings = clause.namedBindings;
    return bindings === undefined || !ts.isNamedImports(bindings) || !onlyTypes(bindings.elements);
  }
  if (ts.isExportDeclaration(node)) {
    if (node.moduleSpecifier === undefined || node.isTypeOnly) return false;
    const clause = node.exportClause;
    return clause === undefined || !ts.isNamedExports(clause) || !onlyTypes(clause.elements);
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference);
  }
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function onlyTypes(elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>): boolean {
  return elements.length > 0 && elements.every((element) => element.isTypeOnly);
}

describe('the sources the release scripts load before the build', () => {
  it.each(SOURCES)('%s imports only types', (file) => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf-8');

    expect(runTimeImports(source)).toEqual([]);
  });

  it('would catch a run-time import', () => {
    expect(
      runTimeImports(
        [
          "import { a } from './x';",
          "import type { B } from './y';",
          "import { type C, d } from './z';",
          "import {} from './empty';",
          "import './side-effect';",
          "export { e } from './re-export';",
          "export type { F } from './type-re-export';",
          "export { type G } from './type-names-re-export';",
          "type N = import('./type-query').N;",
          "const m = await import('./later');",
        ].join('\n'),
      ),
    ).toEqual([
      "import { a } from './x'",
      "import { type C, d } from './z'",
      "import {} from './empty'",
      "import './side-effect'",
      "export { e } from './re-export'",
      "import('./later')",
    ]);
  });
});
