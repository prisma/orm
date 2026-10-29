import { readFileSync } from 'node:fs';
import { getAuthoringTypeConstructor } from '@internal/framework-components/authoring';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { describe, expect, it } from 'vitest';
import citextControl from '../src/exports/control';

const contribManifest = JSON.parse(
  readFileSync(
    new URL('../../../9-public/@prisma/orm-postgres-contrib/package.json', import.meta.url),
    'utf8',
  ),
) as { readonly name: string; readonly exports: Record<string, string> };

describe('the Postgres target reads @db.Citext as this pack', () => {
  const declared = prisma7PostgresBinding.typeMap.extensionNativeTypes['Citext'];
  const pack =
    declared === undefined
      ? undefined
      : prisma7PostgresBinding.extensions.packs[declared.extension];

  it('names the citext extension, declared by this pack', () => {
    expect(declared?.extension).toBe('citext');
    expect(citextControl.contractSpace?.contractJson).toMatchObject({
      storage: { namespaces: { public: { entries: { extension: { citext: {} } } } } },
    });
  });

  it('names the pack id and the constructor the pack registers, marked inferred', () => {
    const typeConstructor = getAuthoringTypeConstructor(
      citextControl.authoring,
      declared?.constructorPath ?? [],
    );
    expect({ packId: pack?.id, typeConstructor }).toEqual({
      packId: citextControl.id,
      typeConstructor: expect.objectContaining({ kind: 'typeConstructor', inferred: true }),
    });
  });

  it('names an import the published package exports', () => {
    const subpath = pack?.importPath.replace(`${contribManifest.name}/`, './');
    expect(subpath !== undefined && Object.hasOwn(contribManifest.exports, subpath)).toBe(true);
  });
});
