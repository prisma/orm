import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const generateRoot = join(sourceRoot, 'generate');

/** Imports and re-exports that load the module when the importing module loads: every `from '...'` except `import type` and `export type`. */
const staticImport = /^(?:import|export)(?!\s+type\s)[^;]*?\sfrom\s+'([^']+)'/gm;

function staticImports(text: string): string[] {
  return [...text.matchAll(staticImport)].flatMap(([, specifier]) =>
    specifier === undefined ? [] : [specifier],
  );
}

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

function isInGenerate(path: string): boolean {
  return path === generateRoot || path.startsWith(`${generateRoot}/`);
}

const loadsTooling = (specifier: string) =>
  specifier.startsWith('node:') || specifier.startsWith('@prisma/orm-toolchain');

function forbidden(file: string, specifier: string): boolean {
  if (isInGenerate(file)) return loadsTooling(specifier);
  return (
    loadsTooling(specifier) ||
    specifier.startsWith('@prisma/orm-framework/psl-parser') ||
    (specifier.startsWith('.') && isInGenerate(resolve(dirname(file), specifier)))
  );
}

describe('what loads with the adapter', () => {
  it('finds static imports and re-exports, and leaves out type-only and dynamic imports', () => {
    expect(
      staticImports(
        [
          "import { a } from 'node:fs';",
          "import type { B } from 'node:path';",
          "export { c } from './c';",
          "export type { D } from './d';",
          "import {\n  e,\n  type F,\n} from '@prisma/orm-toolchain/config-loader';",
          "const g = await import('./generate/g');",
        ].join('\n'),
      ),
    ).toEqual(['node:fs', './c', '@prisma/orm-toolchain/config-loader']);
  });

  it('no module outside src/generate statically imports it, the PSL parser, the toolchain or a Node module, and none inside statically imports the toolchain or a Node module', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      for (const specifier of staticImports(await readFile(file, 'utf8'))) {
        if (forbidden(file, specifier))
          offenders.push(`${relative(sourceRoot, file)}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
