import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCES = ['shells.ts', 'levels.ts', 'release-plan.ts'];

/**
 * Every import that runs, as its source text: every `import` or `export … from` except one marked
 * `type` as a whole, since one whose names are all marked `type` one by one, or that has no names,
 * still loads its module once the types are stripped; an `import x = require(…)`; and a dynamic
 * `import(…)`. A type query such as `import('./x').T` loads nothing and is not one.
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
  if (ts.isImportDeclaration(node)) return node.importClause?.isTypeOnly !== true;
  if (ts.isExportDeclaration(node)) return node.moduleSpecifier !== undefined && !node.isTypeOnly;
  if (ts.isImportEqualsDeclaration(node)) {
    return !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference);
  }
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
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
          "import { type H } from './inline-type';",
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
      "import { type H } from './inline-type'",
      "import './side-effect'",
      "export { e } from './re-export'",
      "export { type G } from './type-names-re-export'",
      "import('./later')",
    ]);
  });
});
