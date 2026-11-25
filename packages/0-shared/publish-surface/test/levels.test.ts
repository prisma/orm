import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packageKinds, packageNumbering } from '../src/levels';
import { hasOwnVersion, levelViolations, type Numbering, parseVersion } from '../src/release-plan';
import { publicShells } from '../src/shells';

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

describe('the declared level or own version of each published package', () => {
  it('names every published package once, and nothing else', () => {
    expect([...packageNumbering.keys()].sort()).toEqual(published.map((m) => m.name).sort());
  });

  it('holds the levels decided for release 8.0', () => {
    expect(
      Object.fromEntries([...packageNumbering].sort(([a], [b]) => a.localeCompare(b))),
    ).toEqual({
      '@prisma/orm-better-auth': 'ga',
      '@prisma/orm-extension-arktype-json': 'ga',
      '@prisma/orm-extension-middleware-cache': 'ga',
      '@prisma/orm-extension-paradedb': { firstVersion: '0.18.0' },
      '@prisma/orm-extension-pgvector': 'ga',
      '@prisma/orm-extension-postgis': 'ga',
      '@prisma/orm-extension-supabase': 'ea',
      '@prisma/orm-family-mongo': 'ea',
      '@prisma/orm-family-sql': 'ga',
      '@prisma/orm-framework': 'ga',
      '@prisma/orm-mariadb': 'ea',
      '@prisma/orm-mongo': 'ea',
      '@prisma/orm-mysql': 'ea',
      '@prisma/orm-postgres': 'ga',
      '@prisma/orm-postgres-contrib': 'ga',
      '@prisma/orm-sqlite': 'ea',
      '@prisma/orm-target-mariadb': 'ea',
      '@prisma/orm-target-mongo': 'ea',
      '@prisma/orm-target-mysql': 'ea',
      '@prisma/orm-target-postgres': 'ga',
      '@prisma/orm-target-sqlite': 'ea',
      '@prisma/orm-toolchain': 'ga',
    });
  });

  it('gives every published package a kind: the shell map’s, and Better Auth a library integration', () => {
    const kinds = packageKinds(publicShells);

    expect([...Object.keys(kinds)].sort()).toEqual(published.map((m) => m.name).sort());
    expect({
      'better-auth': kinds['@prisma/orm-better-auth'],
      postgres: kinds['@prisma/orm-postgres'],
      framework: kinds['@prisma/orm-framework'],
      pgvector: kinds['@prisma/orm-extension-pgvector'],
    }).toEqual({
      'better-auth': 'library-integration',
      postgres: 'facade',
      framework: 'platform',
      pgvector: 'extension',
    });
  });

  it('starts ParadeDB above every version it was published as before the release candidates', () => {
    const numbering = packageNumbering.get('@prisma/orm-extension-paradedb');
    const first = hasOwnVersion(numbering) ? parseVersion(numbering.firstVersion) : undefined;
    const published = [
      '0.16.0-dev.36',
      '0.16.0-dev.40',
      '0.16.0',
      '0.17.0-dev.1',
      '0.17.0-dev.12',
      '0.17.0',
    ];

    expect(
      published.filter((text) => {
        const earlier = parseVersion(text);
        return (
          first === undefined ||
          (first.major - earlier.major ||
            first.minor - earlier.minor ||
            first.patch - earlier.patch) <= 0
        );
      }),
    ).toEqual([]);
  });

  it('lets no package name one of ours at a lower level than its own', () => {
    expect(levelViolations(packageNumbering, uses)).toEqual([]);
  });
});

describe('levelViolations', () => {
  it.each([
    [
      'a GA package naming a Preview one',
      { a: 'ga', b: 'preview' },
      { a: ['b'] },
      [{ user: 'a', userNumbering: 'ga', named: 'b', namedNumbering: 'preview' }],
    ],
    [
      'MariaDB above MySQL',
      { mariadb: 'rc', mysql: 'ea' },
      { mariadb: ['mysql'] },
      [{ user: 'mariadb', userNumbering: 'rc', named: 'mysql', namedNumbering: 'ea' }],
    ],
    ['a Preview package naming a GA one', { a: 'preview', b: 'ga' }, { a: ['b'] }, []],
    ['two packages at one level', { a: 'ea', b: 'ea' }, { a: ['b'] }, []],
    [
      'a package with its own version naming any level',
      { a: { firstVersion: '0.1.0' }, b: 'ea' },
      { a: ['b'] },
      [],
    ],
    [
      'a package naming one with its own version',
      { a: 'ga', b: { firstVersion: '0.1.0' } },
      { a: ['b'] },
      [{ user: 'a', userNumbering: 'ga', named: 'b', namedNumbering: { firstVersion: '0.1.0' } }],
    ],
  ])('%s', (_case, numbering, graph, violations) => {
    expect(
      levelViolations(new Map(Object.entries(numbering as Record<string, Numbering>)), graph),
    ).toEqual(violations);
  });
});
