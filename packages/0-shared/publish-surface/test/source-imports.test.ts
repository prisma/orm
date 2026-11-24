import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const SOURCES = ['shells.ts', 'levels.ts', 'release-plan.ts'];

/**
 * Every import that runs: an `import` or `export … from` statement that is not type-only, an
 * `import './x'` for its side effects, and a dynamic `import(…)`.
 */
function runTimeImports(source: string): string[] {
  const fromStatements = [
    ...source.matchAll(/^\s*(import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"][^'"]+['"]/gm),
  ]
    .map((match) => match[0].trim())
    .filter((statement) => !onlyTypes(statement));
  const sideEffects = [...source.matchAll(/^\s*import\s+['"][^'"]+['"]/gm)].map((match) =>
    match[0].trim(),
  );
  const dynamic = [...source.matchAll(/\bimport\s*\(/g)].map((match) => match[0]);
  return [...fromStatements, ...sideEffects, ...dynamic];
}

function onlyTypes(statement: string): boolean {
  const names = /^(?:import|export)\s*\{([^}]*)\}/.exec(statement)?.[1];
  if (names === undefined) return false;
  return names
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .every((name) => name.startsWith('type '));
}

describe('the sources the release scripts load before the build', () => {
  it.each(SOURCES)('%s imports only types', (file) => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf-8');

    expect(runTimeImports(source)).toEqual([]);
  });

  it('would catch a run-time import', () => {
    expect(
      runTimeImports(
        "import { a } from './x';\nimport type { B } from './y';\nimport { type C, d } from './z';\nimport './side-effect';\nconst m = await import('./later');",
      ),
    ).toEqual([
      "import { a } from './x'",
      "import { type C, d } from './z'",
      "import './side-effect'",
      'import(',
    ]);
  });
});
