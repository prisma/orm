import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packageLevels } from '../src/levels';
import { levelViolations } from '../src/release-plan';

const publishedRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '9-public',
  '@prisma',
);

interface Manifest {
  readonly name: string;
  readonly private?: boolean;
  readonly peerDependencies?: Record<string, string>;
}

const manifests: readonly Manifest[] = readdirSync(publishedRoot).map((dir) =>
  JSON.parse(readFileSync(join(publishedRoot, dir, 'package.json'), 'utf8')),
);
const published = manifests.filter((manifest) => manifest.private !== true);

/** Who names whom among our published packages, read from each manifest's `peerDependencies`. */
const uses: Record<string, readonly string[]> = Object.fromEntries(
  published.map((manifest) => [
    manifest.name,
    Object.keys(manifest.peerDependencies ?? {}).filter((peer) => peer.startsWith('@prisma/orm-')),
  ]),
);

describe('the declared level of each published package', () => {
  it('names every published package once, and nothing else', () => {
    expect([...packageLevels.keys()].sort()).toEqual(published.map((m) => m.name).sort());
  });

  it('holds the levels decided for 8.0.0', () => {
    expect(Object.fromEntries([...packageLevels].sort(([a], [b]) => a.localeCompare(b)))).toEqual({
      '@prisma/orm-better-auth': 'preview',
      '@prisma/orm-extension-arktype-json': 'ga',
      '@prisma/orm-extension-middleware-cache': 'preview',
      '@prisma/orm-extension-paradedb': 'own-version',
      '@prisma/orm-extension-pgvector': 'ga',
      '@prisma/orm-extension-postgis': 'ga',
      '@prisma/orm-extension-supabase': 'preview',
      '@prisma/orm-family-mongo': 'preview',
      '@prisma/orm-family-sql': 'ga',
      '@prisma/orm-framework': 'ga',
      '@prisma/orm-mariadb': 'ea',
      '@prisma/orm-mongo': 'preview',
      '@prisma/orm-mysql': 'ea',
      '@prisma/orm-postgres': 'ga',
      '@prisma/orm-postgres-contrib': 'ga',
      '@prisma/orm-sqlite': 'ea',
      '@prisma/orm-target-mariadb': 'ea',
      '@prisma/orm-target-mongo': 'preview',
      '@prisma/orm-target-mysql': 'ea',
      '@prisma/orm-target-postgres': 'ga',
      '@prisma/orm-target-sqlite': 'ea',
      '@prisma/orm-toolchain': 'ga',
    });
  });

  it('lets no package name one of ours at a lower level than its own', () => {
    expect(levelViolations(packageLevels, uses)).toEqual([]);
  });
});

describe('levelViolations', () => {
  it.each([
    [
      'a GA package naming a Preview one',
      { a: 'ga', b: 'preview' },
      { a: ['b'] },
      [{ user: 'a', userLevel: 'ga', named: 'b', namedLevel: 'preview' }],
    ],
    [
      'MariaDB above MySQL',
      { mariadb: 'rc', mysql: 'ea' },
      { mariadb: ['mysql'] },
      [{ user: 'mariadb', userLevel: 'rc', named: 'mysql', namedLevel: 'ea' }],
    ],
    ['a Preview package naming a GA one', { a: 'preview', b: 'ga' }, { a: ['b'] }, []],
    ['two packages at one level', { a: 'ea', b: 'ea' }, { a: ['b'] }, []],
    ['an own-version package naming any level', { a: 'own-version', b: 'ea' }, { a: ['b'] }, []],
    [
      'a package naming an own-version one',
      { a: 'ga', b: 'own-version' },
      { a: ['b'] },
      [{ user: 'a', userLevel: 'ga', named: 'b', namedLevel: 'own-version' }],
    ],
  ] as const)('%s', (_case, levels, graph, violations) => {
    expect(levelViolations(new Map(Object.entries(levels)), graph)).toEqual(violations);
  });
});
