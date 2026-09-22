import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publicShells } from '../src/shells';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function manifestName(dir: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || !('name' in manifest)) {
    throw new Error(`${dir}/package.json has no name`);
  }
  const { name } = manifest;
  if (typeof name !== 'string') throw new Error(`${dir}/package.json name is not a string`);
  return name;
}

describe('publicShells', () => {
  it('declares the package name each mapped directory actually has', () => {
    const drifted = [...publicShells.values()]
      .flatMap((shell) => shell.packages)
      .filter((pkg) => manifestName(pkg.dir) !== pkg.name)
      .map((pkg) => `${pkg.dir}: declared ${pkg.name}, manifest ${manifestName(pkg.dir)}`);

    expect(drifted).toEqual([]);
  });

  it('maps each internal package into exactly one shell', () => {
    const owners = new Map<string, string[]>();
    for (const [shellName, shell] of publicShells) {
      for (const pkg of shell.packages) {
        owners.set(pkg.name, [...(owners.get(pkg.name) ?? []), shellName]);
      }
    }
    const duplicated = [...owners].filter(([, shells]) => shells.length > 1);

    expect(duplicated).toEqual([]);
  });

  it('re-exports only packages another shell publishes', () => {
    const published = new Set(
      [...publicShells.values()].flatMap((shell) => shell.packages.map((pkg) => pkg.name)),
    );
    const dangling = [...publicShells.values()]
      .flatMap((shell) => shell.reexports ?? [])
      .map((reexport) => reexport.package)
      .filter((name) => !published.has(name));

    expect(dangling).toEqual([]);
  });

  // `kind` decides which shells emitted code may name, so it has to track the
  // shells rather than record what they happened to be on the day it was
  // written. These two pin it to the naming rule and to the structure that
  // rule stands for.
  it('classifies each shell the way its name says', () => {
    const expectedKind = (name: string) => {
      if (name.startsWith('@prisma/orm-extension-')) return 'extension';
      return /^@prisma\/orm-(framework|toolchain|family-|target-)/.test(name)
        ? 'platform'
        : 'facade';
    };

    for (const [name, shell] of publicShells) {
      expect(`${name}: ${shell.kind}`).toBe(`${name}: ${expectedKind(name)}`);
    }
  });

  it('declares only subpaths the mapped package actually exports', () => {
    const dangling = [...publicShells.values()]
      .flatMap((shell) => shell.packages)
      .filter((pkg) => pkg.subpaths !== undefined)
      .flatMap((pkg) => {
        const manifest: unknown = JSON.parse(
          readFileSync(join(repoRoot, pkg.dir, 'package.json'), 'utf8'),
        );
        const exported = new Set(
          Object.keys((manifest as { exports?: Record<string, unknown> }).exports ?? {}).map(
            (subpath) => subpath.replace(/^\.\//, ''),
          ),
        );
        return (pkg.subpaths ?? [])
          .filter((subpath) => !exported.has(subpath))
          .map((subpath) => `${pkg.name}: ${subpath}`);
      });

    expect(dangling).toEqual([]);
  });

  it('publishes the Prisma schema sources only through the entrypoints applications import', () => {
    const published = (shellDir: string, pattern: RegExp): string[] => {
      const manifest: unknown = JSON.parse(
        readFileSync(join(repoRoot, shellDir, 'package.json'), 'utf8'),
      );
      return Object.keys((manifest as { exports?: Record<string, unknown> }).exports ?? {}).filter(
        (subpath) => pattern.test(subpath),
      );
    };

    expect(published('packages/9-public/@prisma/orm-family-sql', /contract-(psl|prisma7)/)).toEqual(
      [
        './contract-prisma7/provider',
        './contract-psl',
        './contract-psl/attribute-specs',
        './contract-psl/default-table-name',
        './contract-psl/provider',
      ],
    );
    expect(published('packages/9-public/@prisma/orm-target-postgres', /prisma7/)).toEqual([
      './target/prisma7-binding',
    ]);
    expect(published('packages/9-public/@prisma/orm-postgres', /prisma7/)).toEqual([]);
  });

  it('forwards every Postgres target export from the Postgres facade except the ones only the facade imports', () => {
    const notForwardedByFacade = ['prisma7-binding'];
    const manifest: unknown = JSON.parse(
      readFileSync(join(repoRoot, 'packages/3-targets/3-targets/postgres/package.json'), 'utf8'),
    );
    const targetSubpaths = Object.keys(
      (manifest as { exports?: Record<string, unknown> }).exports ?? {},
    )
      .filter((subpath) => subpath.startsWith('./') && subpath !== './package.json')
      .map((subpath) => subpath.slice(2));
    const forwarded = publicShells
      .get('@prisma/orm-postgres')
      ?.reexports?.find((reexport) => reexport.package === '@internal/target-postgres')?.subpaths;

    expect([...(forwarded ?? [])].sort()).toEqual(
      targetSubpaths.filter((subpath) => !notForwardedByFacade.includes(subpath)).sort(),
    );
  });

  it('gives exactly the facades the re-exports that make one', () => {
    for (const [name, shell] of publicShells) {
      expect(`${name}: ${shell.reexports !== undefined}`).toBe(
        `${name}: ${shell.kind === 'facade'}`,
      );
    }
  });
});
