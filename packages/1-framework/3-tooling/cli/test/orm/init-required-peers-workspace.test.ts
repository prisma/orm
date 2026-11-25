import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENGINE_PACKAGE } from '../../src/orm/init-packages';
import { installedManifests, resolveRequiredPeers } from '../../src/orm/init-required-peers';

const publishedRoot = resolve(import.meta.dirname, '../../../../../9-public/@prisma');

/**
 * A project whose `node_modules/@prisma` holds this repository's published packages, linked from
 * their source folders, so `init`'s own reader reads their real manifests. Their peers keep the
 * `workspace:` form, which pnpm rewrites to the plain version when it publishes.
 */
let projectDir: string;

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'orm-init-workspace-manifests-'));
  mkdirSync(join(projectDir, 'node_modules', '@prisma'), { recursive: true });
  for (const name of readdirSync(publishedRoot)) {
    symlinkSync(
      join(publishedRoot, name),
      join(projectDir, 'node_modules', '@prisma', name),
      'dir',
    );
  }
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function versionOf(packageName: string): string {
  return JSON.parse(
    readFileSync(
      join(publishedRoot, packageName.slice('@prisma/'.length), 'package.json'),
      'utf-8',
    ),
  ).version;
}

const PLATFORM = {
  postgres: [
    '@prisma/orm-family-sql',
    '@prisma/orm-framework',
    '@prisma/orm-target-postgres',
    '@prisma/orm-toolchain',
  ],
  sqlite: [
    '@prisma/orm-family-sql',
    '@prisma/orm-framework',
    '@prisma/orm-target-sqlite',
    '@prisma/orm-toolchain',
  ],
  mysql: [
    '@prisma/orm-family-sql',
    '@prisma/orm-framework',
    '@prisma/orm-target-mysql',
    '@prisma/orm-toolchain',
  ],
  mariadb: [
    '@prisma/orm-family-sql',
    '@prisma/orm-framework',
    '@prisma/orm-mysql',
    '@prisma/orm-target-mariadb',
    '@prisma/orm-target-mysql',
    '@prisma/orm-toolchain',
  ],
  mongo: [
    '@prisma/orm-family-mongo',
    '@prisma/orm-framework',
    '@prisma/orm-target-mongo',
    '@prisma/orm-toolchain',
  ],
} as const;

/** Each facade's required peers: its platform packages, then the others at their ranges. */
const expected: Readonly<
  Record<
    string,
    { readonly platform: readonly string[]; readonly others: Readonly<Record<string, string>> }
  >
> = {
  '@prisma/orm-postgres': {
    platform: PLATFORM.postgres,
    others: { '@types/pg': '^8.20.0', pg: '^8.22.0', 'temporal-polyfill': '^1.0.8' },
  },
  '@prisma/orm-sqlite': { platform: PLATFORM.sqlite, others: { 'temporal-polyfill': '^1.0.8' } },
  '@prisma/orm-mysql': { platform: PLATFORM.mysql, others: { 'temporal-polyfill': '^1.0.8' } },
  '@prisma/orm-mariadb': { platform: PLATFORM.mariadb, others: { 'temporal-polyfill': '^1.0.8' } },
  '@prisma/orm-mongo': {
    platform: PLATFORM.mongo,
    others: { mongodb: '^7.0.0', 'temporal-polyfill': '^1.0.8' },
  },
};

describe("the required peers of this repository's facades", () => {
  it.each(Object.entries(expected))(
    'lists those of %s',
    async (packageName, { platform, others }) => {
      const version = versionOf(packageName);
      const manifests = installedManifests(projectDir, packageName);

      const resolved = await resolveRequiredPeers({
        packageName,
        facadeLine: 'report',
        installedElsewhere: new Set([ENGINE_PACKAGE]),
        declared: () => new Map(),
        installedVersion: manifests.installedVersion,
        install: undefined,
        read: manifests.read,
      });

      expect(resolved).toEqual({
        facade: `${packageName}@${version}`,
        packages: [
          ...platform.map((name) => ({
            name,
            version: `workspace:${version}`,
            outcome: 'to-install',
          })),
          ...Object.entries(others).map(([name, range]) => ({
            name,
            version: range,
            outcome: 'to-install',
          })),
        ],
        unread: [],
        warnings: [],
      });
    },
  );
});
