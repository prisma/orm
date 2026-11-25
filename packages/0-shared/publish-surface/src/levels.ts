// Scripts load this file from source, before the workspace is built, so it may import only types.
import type { DeclaredLevel, PackageKind } from './release-plan';

/**
 * The maturity level of every package this repository publishes, as decided for `8.0.0`. A
 * package's version, tag and the ranges others write on it follow from its level; see
 * `planRelease`. `{ firstVersion }` marks a package numbered outside the release number, with no
 * level: this is the one home of its version at the first release with levels; after that its
 * version is in its manifest.
 *
 * `@prisma/orm-extension-middleware-cache` and `@prisma/orm-better-auth` are Preview until the
 * operator decides otherwise.
 */
export const packageLevels: ReadonlyMap<string, DeclaredLevel> = new Map<string, DeclaredLevel>([
  ['@prisma/orm-postgres', 'ga'],
  ['@prisma/orm-framework', 'ga'],
  ['@prisma/orm-toolchain', 'ga'],
  ['@prisma/orm-family-sql', 'ga'],
  ['@prisma/orm-target-postgres', 'ga'],
  ['@prisma/orm-extension-pgvector', 'ga'],
  ['@prisma/orm-extension-postgis', 'ga'],
  ['@prisma/orm-postgres-contrib', 'ga'],
  ['@prisma/orm-extension-arktype-json', 'ga'],
  ['@prisma/orm-mongo', 'preview'],
  ['@prisma/orm-family-mongo', 'preview'],
  ['@prisma/orm-target-mongo', 'preview'],
  ['@prisma/orm-extension-supabase', 'preview'],
  ['@prisma/orm-extension-middleware-cache', 'preview'],
  ['@prisma/orm-better-auth', 'preview'],
  ['@prisma/orm-mysql', 'ea'],
  ['@prisma/orm-target-mysql', 'ea'],
  ['@prisma/orm-mariadb', 'ea'],
  ['@prisma/orm-target-mariadb', 'ea'],
  ['@prisma/orm-sqlite', 'ea'],
  ['@prisma/orm-target-sqlite', 'ea'],
  ['@prisma/orm-extension-paradedb', { firstVersion: '0.1.0' }],
]);

/**
 * The `N` of the last `8.0.0-rc.N`, once `8.0.0` has been released; until then the plan reads it
 * from the manifests, which all hold it. Within release `8.0`, a package at `rc` continues above it.
 */
export const lastReleaseCandidate: number | undefined = undefined;

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
