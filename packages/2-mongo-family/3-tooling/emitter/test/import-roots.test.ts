import { generateContractDts } from '@internal/emitter';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import {
  createImportSpecifierResolver,
  type ImportRoot,
  importedSpecifiers,
  internalImportRoot,
  transitiveImports,
} from '@internal/publish-surface/import-roots';
import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import { createMongoContract } from './fixtures/create-mongo-contract';

const mongoFacade: ImportRoot = { mode: 'facade', facade: '@prisma/orm-mongo' };
const platform: ImportRoot = { mode: 'platform' };

const hashes = { storageHash: 'storage', profileHash: 'profile' };

const codecTypeImports: TypesImportSpec[] = [
  {
    package: '@internal/target-mongo/codec-types',
    named: 'CodecTypes',
    alias: 'MongoCodecTypes',
  },
];

function emit(root: ImportRoot): string {
  return generateContractDts(
    createMongoContract(),
    mongoEmission,
    codecTypeImports,
    hashes,
    undefined,
    undefined,
    createImportSpecifierResolver(root),
  );
}

describe('emitted contract types under each import root', () => {
  it('names workspace packages under the internal root', () => {
    expect(importedSpecifiers(emit(internalImportRoot)).sort()).toEqual([
      '@internal/contract/types',
      '@internal/mongo-contract',
      '@internal/target-mongo/codec-types',
    ]);
  });

  it('names the facade under the facade root', () => {
    expect(importedSpecifiers(emit(mongoFacade)).sort()).toEqual([
      '@prisma/orm-mongo/contract/types',
      '@prisma/orm-mongo/family-contract',
      '@prisma/orm-mongo/target/codec-types',
    ]);
  });

  it('names the platform packages under the platform root', () => {
    expect(importedSpecifiers(emit(platform)).sort()).toEqual([
      '@prisma/orm-family-mongo/contract',
      '@prisma/orm-framework/contract/types',
      '@prisma/orm-target-mongo/target/codec-types',
    ]);
  });

  it('imports nothing the application would not depend on directly', () => {
    for (const root of [internalImportRoot, mongoFacade, platform]) {
      expect(transitiveImports(emit(root), root)).toEqual([]);
    }
  });

  it('changes nothing but the import specifiers', () => {
    const withoutImports = (source: string) =>
      source
        .split('\n')
        .filter((line) => !line.includes("from '"))
        .join('\n');

    expect(withoutImports(emit(mongoFacade))).toEqual(withoutImports(emit(internalImportRoot)));
    expect(withoutImports(emit(platform))).toEqual(withoutImports(emit(internalImportRoot)));
  });
});
