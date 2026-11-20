import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publicShells } from '../src/shells';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** `prisma orm init` installs or uses a target package only when its manifest lists this keyword. */
const INIT_KEYWORD = 'prisma-orm-extension';

function manifestOf(dir: string): { readonly exports: object; readonly keywords: unknown } {
  const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error(`${dir}/package.json is not an object`);
  }
  const exports: unknown = Reflect.get(manifest, 'exports');
  return {
    exports: typeof exports === 'object' && exports !== null ? exports : {},
    keywords: Reflect.get(manifest, 'keywords'),
  };
}

function listsKeyword(dir: string): boolean {
  const { keywords } = manifestOf(dir);
  return Array.isArray(keywords) && keywords.includes(INIT_KEYWORD);
}

/** The database packages, and any other package init could load an init contribution from. */
const targetShells = [...publicShells].filter(
  ([, shell]) => shell.kind === 'facade' || Object.hasOwn(manifestOf(shell.dir).exports, './init'),
);

describe('published manifests', () => {
  it('cover every database package', () => {
    expect(targetShells.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        '@prisma/orm-postgres',
        '@prisma/orm-mongo',
        '@prisma/orm-sqlite',
        '@prisma/orm-mysql',
        '@prisma/orm-mariadb',
      ]),
    );
  });

  it('list the keyword init requires on every database package', () => {
    const missing = targetShells
      .filter(([, shell]) => !listsKeyword(shell.dir))
      .map(([name]) => name);

    expect(missing).toEqual([]);
  });

  it('list the keyword on each internal package a database package is built from', () => {
    const missing = targetShells.flatMap(([, shell]) =>
      shell.packages.filter((pkg) => !listsKeyword(pkg.dir)).map((pkg) => pkg.name),
    );

    expect(missing).toEqual([]);
  });
});
