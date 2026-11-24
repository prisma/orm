import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installedManifests, resolveOrmPeerPackages } from '../../src/orm/init-orm-peer-packages';

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

const expected: Readonly<Record<string, readonly string[]>> = {
  '@prisma/orm-postgres': [
    '@prisma/orm-family-sql',
    '@prisma/orm-framework',
    '@prisma/orm-target-postgres',
    '@prisma/orm-toolchain',
  ],
  '@prisma/orm-sqlite': [
    '@prisma/orm-family-sql',
    '@prisma/orm-framework',
    '@prisma/orm-target-sqlite',
    '@prisma/orm-toolchain',
  ],
  '@prisma/orm-mysql': [
    '@prisma/orm-family-sql',
    '@prisma/orm-framework',
    '@prisma/orm-target-mysql',
    '@prisma/orm-toolchain',
  ],
  '@prisma/orm-mariadb': [
    '@prisma/orm-family-sql',
    '@prisma/orm-framework',
    '@prisma/orm-mysql',
    '@prisma/orm-target-mariadb',
    '@prisma/orm-target-mysql',
    '@prisma/orm-toolchain',
  ],
  '@prisma/orm-mongo': [
    '@prisma/orm-family-mongo',
    '@prisma/orm-framework',
    '@prisma/orm-target-mongo',
    '@prisma/orm-toolchain',
  ],
};

describe("the Prisma ORM peer packages of this repository's target packages", () => {
  it.each(Object.entries(expected))('lists those of %s', async (packageName, names) => {
    const version = versionOf(packageName);
    const manifests = installedManifests(projectDir);

    const resolved = await resolveOrmPeerPackages({
      packageName,
      ownsTarget: false,
      declared: () => new Map(),
      installedVersion: manifests.installedVersion,
      install: undefined,
      read: manifests.read,
    });

    expect(resolved).toEqual({
      target: `${packageName}@${version}`,
      packages: names.map((name) => ({
        name,
        version: `workspace:${version}`,
        outcome: 'to-install',
      })),
      unread: [],
      warnings: [],
    });
  });
});
