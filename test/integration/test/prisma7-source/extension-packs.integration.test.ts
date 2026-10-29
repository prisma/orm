import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import paradedb from '@internal/extension-paradedb/control';
import pgvector from '@internal/extension-pgvector/control';
import postgis from '@internal/extension-postgis/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const descriptors = new Map([pgvector, postgis, paradedb].map((pack) => [pack.id, pack]));
const internalPackages = new Map([
  ['@internal/extension-pgvector', pgvector.id],
  ['@internal/extension-postgis', postgis.id],
  ['@internal/extension-paradedb', paradedb.id],
]);
const publicPackagesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/9-public',
);

interface PublishedPackage {
  readonly name: string;
  readonly exports: Record<string, string>;
  readonly devDependencies: Record<string, string>;
}

function publishedPackage(name: string): PublishedPackage {
  return JSON.parse(readFileSync(join(publicPackagesDir, name, 'package.json'), 'utf8'));
}

interface SerializedNamespaces {
  readonly storage: {
    readonly namespaces: Record<string, { readonly entries: { readonly extension?: object } }>;
  };
}

function declaredExtensions(contractJson: unknown): string[] {
  return Object.values((contractJson as SerializedNamespaces).storage.namespaces).flatMap(
    (namespace) => Object.keys(namespace.entries.extension ?? {}),
  );
}

describe('the Prisma 7 binding’s extension packs', () => {
  for (const [extension, pack] of Object.entries(prisma7PostgresBinding.extensions.packs)) {
    it(`names the pack whose contract declares ${extension}`, () => {
      const descriptor = descriptors.get(pack.id);
      expect(descriptor?.id).toBe(pack.id);
      expect(declaredExtensions(descriptor?.contractSpace?.contractJson)).toContain(extension);
    });

    it(`names the published package that ships the pack declaring ${extension}`, () => {
      const [packageName, entry] = pack.importPath.split(/\/(?=[^/]+$)/);
      const published = publishedPackage(packageName ?? '');
      expect(published.name).toBe(packageName);
      expect(Object.keys(published.exports)).toContain(`./${entry}`);
      const shipped = Object.keys(published.devDependencies).map((name) =>
        internalPackages.get(name),
      );
      expect(shipped).toContain(pack.id);
    });
  }
});
