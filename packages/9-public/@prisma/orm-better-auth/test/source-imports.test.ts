import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url));
const generateRoot = join(sourceRoot, 'generate');

/** Imports and re-exports that load the module when the importing module loads: every `from '...'` except `import type` and `export type`, and every side-effect `import '...'`. */
const staticImport = /^(?:(?:import|export)(?!\s+type\s)[^;]*?\sfrom\s+|import\s+)'([^']+)'/gm;

function staticImports(text: string): string[] {
  return [...text.matchAll(staticImport)].flatMap(([, specifier]) =>
    specifier === undefined ? [] : [specifier],
  );
}

/** Every module a file names after `from` or in `import(...)`, type-only imports included. */
const anyImport = /(?:\bfrom\s+|\bimport\s*\(\s*|^import\s+)'([^']+)'/gm;

function allImports(text: string): string[] {
  return [...text.matchAll(anyImport)].flatMap(([, specifier]) =>
    specifier === undefined ? [] : [specifier],
  );
}

/** The package a bare `@prisma/` specifier names, or `undefined` for any other specifier. */
function prismaPackageOf(specifier: string): string | undefined {
  const [scope, name] = specifier.split('/');
  return scope === '@prisma' && name !== undefined ? `${scope}/${name}` : undefined;
}

async function peerDependencies(): Promise<Set<string>> {
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  const peers: unknown =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'peerDependencies')
      : undefined;
  return new Set(typeof peers === 'object' && peers !== null ? Object.keys(peers) : []);
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
          "import './generate/side-effect';",
        ].join('\n'),
      ),
    ).toEqual(['node:fs', './c', '@prisma/orm-toolchain/config-loader', './generate/side-effect']);
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

describe('the Prisma packages the adapter imports', () => {
  it('finds static, type-only, re-exported and dynamic imports, and names their package', () => {
    expect(
      allImports(
        [
          "import { a } from '@prisma/orm-postgres/runtime';",
          "import type { B } from '@prisma/orm-sqlite';",
          "export { c } from './c';",
          "const d = await import('@prisma/orm-family-sql/orm-client');",
        ].join('\n'),
      ).map(prismaPackageOf),
    ).toEqual(['@prisma/orm-postgres', '@prisma/orm-sqlite', undefined, '@prisma/orm-family-sql']);
  });

  it('every @prisma package that src imports, even only for its types, is a peer dependency, so no database package is', async () => {
    const peers = await peerDependencies();
    expect(peers.has('@prisma/orm-family-sql')).toBe(true);
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      for (const specifier of allImports(await readFile(file, 'utf8'))) {
        const name = prismaPackageOf(specifier);
        if (name !== undefined && !peers.has(name)) {
          offenders.push(`${relative(sourceRoot, file)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
