import type { DeclaredLevel } from './release-plan';

/**
 * The maturity level of every package this repository publishes, as decided for `8.0.0`. A
 * package's version, tag and the ranges others write on it follow from its level; see
 * `planRelease`. `own-version` marks a package numbered outside the release number.
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
  ['@prisma/orm-extension-paradedb', 'own-version'],
]);
