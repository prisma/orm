// Scripts load this file from source, before the workspace is built, so it may import only types.
import type { Numbering, PackageKind } from './release-plan';

/**
 * How every package this repository publishes is numbered, as decided for release `8.0`: its
 * maturity level, or `{ firstVersion }` for a package that has its own version and no level. A
 * package's version, tag and the ranges others write on it follow from this; see `planRelease`.
 * This is the one home of an own version at the first release with levels; after that it is in the
 * package's manifest.
 */
export const packageNumbering: ReadonlyMap<string, Numbering> = new Map<string, Numbering>([
  ['@prisma/orm-postgres', 'ga'],
  ['@prisma/orm-framework', 'ga'],
  ['@prisma/orm-toolchain', 'ga'],
  ['@prisma/orm-family-sql', 'ga'],
  ['@prisma/orm-target-postgres', 'ga'],
  ['@prisma/orm-extension-pgvector', 'ga'],
  ['@prisma/orm-extension-postgis', 'ga'],
  ['@prisma/orm-postgres-contrib', 'ga'],
  ['@prisma/orm-extension-arktype-json', 'ga'],
  ['@prisma/orm-extension-middleware-cache', 'ga'],
  ['@prisma/orm-better-auth', 'ga'],
  ['@prisma/orm-extension-supabase', 'ea'],
  ['@prisma/orm-mongo', 'ea'],
  ['@prisma/orm-family-mongo', 'ea'],
  ['@prisma/orm-target-mongo', 'ea'],
  ['@prisma/orm-mysql', 'ea'],
  ['@prisma/orm-target-mysql', 'ea'],
  ['@prisma/orm-mariadb', 'ea'],
  ['@prisma/orm-target-mariadb', 'ea'],
  ['@prisma/orm-sqlite', 'ea'],
  ['@prisma/orm-target-sqlite', 'ea'],
  ['@prisma/orm-extension-paradedb', { firstVersion: '0.1.0' }],
]);

/**
 * The kind of every published package: the shell map's `kind` for each shell, and a library
 * integration for `@prisma/orm-better-auth`, which is not a shell. A facade or platform package
 * writes a tilde on the packages it names; an extension or library integration a caret on a GA one.
 */
export function packageKinds(
  shells: ReadonlyMap<string, { readonly kind: 'platform' | 'facade' | 'extension' }>,
): Readonly<Record<string, PackageKind>> {
  return {
    ...Object.fromEntries([...shells].map(([name, shell]) => [name, shell.kind])),
    '@prisma/orm-better-auth': 'library-integration',
  };
}
