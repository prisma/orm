import { readFileSync } from 'node:fs';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { resolveOrmPeerPackages } from '../../src/orm/init-orm-peer-packages';

const publishedRoot = resolve(import.meta.dirname, '../../../../../9-public');

/** A manifest of this repository as it publishes: `workspace:<version>` becomes `<version>`. */
async function readWorkspaceManifest(name: string) {
  const manifest = JSON.parse(readFileSync(join(publishedRoot, name, 'package.json'), 'utf-8'));
  const peers = Object.fromEntries(
    Object.entries<string>(manifest.peerDependencies ?? {}).map(([peer, range]) => [
      peer,
      range.replace(/^workspace:/, ''),
    ]),
  );
  return {
    version: manifest.version,
    peers: new Map(Object.entries(peers).filter(([peer]) => peer.startsWith('@prisma/orm-'))),
  };
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
    const { version } = await readWorkspaceManifest(packageName);

    const resolved = await resolveOrmPeerPackages({
      packageName,
      ownsTarget: false,
      declared: () => new Map(),
      installedVersion: () => undefined,
      install: undefined,
      read: (name) => readWorkspaceManifest(name),
    });

    expect(resolved).toEqual({
      target: `${packageName}@${version}`,
      packages: names.map((name) => ({ name, version, outcome: 'to-install' })),
      unread: [],
      warnings: [],
    });
  });
});
