import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  createImportSpecifierResolver,
  type ImportRoot,
  importedSpecifiers,
  internalImportRoot,
} from '@internal/publish-surface/import-roots';
import { describe, expect, it } from 'vitest';
import { createMockSpi } from './mock-spi';
import { createTestContract, emit } from './utils';

const postgresFacade: ImportRoot = { mode: 'facade', facade: '@prisma/orm-postgres' };
const platform: ImportRoot = { mode: 'platform' };
const allRoots = [internalImportRoot, postgresFacade, platform];

const spi = createMockSpi();

// An extension pack, not a target: Domain 1 may not name a Domain 3 target
// package even inside a string (`pnpm lint:deps`). Which package it is does
// not matter here — the specifier-mapping cases live in the family emitters'
// own tests; this file is about contract identity.
const stack = {
  codecTypeImports: [
    {
      package: '@internal/extension-arktype-json/codec-types',
      named: 'CodecTypes',
      alias: 'PackCodecTypes',
    },
  ],
};

function contract() {
  return createTestContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: { id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    },
  });
}

function emitFor(root: ImportRoot) {
  return emit(contract(), stack, spi, {
    resolveImportSpecifier: createImportSpecifierResolver(root),
  });
}

describe('import roots and contract identity', () => {
  it('leaves every contract hash unchanged across roots', async () => {
    const [internal, facade, decomposed] = await Promise.all(allRoots.map(emitFor));

    const identity = (result: Awaited<ReturnType<typeof emitFor>>) => ({
      storageHash: result.storageHash,
      executionHash: result.executionHash,
      profileHash: result.profileHash,
    });

    expect(identity(facade!)).toEqual(identity(internal!));
    expect(identity(decomposed!)).toEqual(identity(internal!));
  });

  it('leaves contract.json byte-identical across roots', async () => {
    const [internal, facade, decomposed] = await Promise.all(allRoots.map(emitFor));

    expect(facade?.contractJson).toBe(internal?.contractJson);
    expect(decomposed?.contractJson).toBe(internal?.contractJson);
  });

  it('rewrites only the import specifiers in contract.d.ts', async () => {
    const [internal, facade] = await Promise.all([internalImportRoot, postgresFacade].map(emitFor));
    const withoutImports = (source: string) =>
      source
        .split('\n')
        .filter((line) => !line.includes("from '"))
        .join('\n');

    expect(importedSpecifiers(facade?.contractDts ?? '')).not.toEqual(
      importedSpecifiers(internal?.contractDts ?? ''),
    );
    expect(withoutImports(facade?.contractDts ?? '')).toBe(
      withoutImports(internal?.contractDts ?? ''),
    );
  });

  it('names the platform packages under the platform root', async () => {
    const decomposed = await emitFor(platform);

    // `@internal/sql-contract/types` stays as authored because the mock SPI
    // contributes it as a finished import line rather than as a requirement.
    // That is how the real seam works too: a family emitter resolves the
    // specifiers in the text it hands over, and the framework emitter resolves
    // the ones it assembles itself.
    expect(importedSpecifiers(decomposed.contractDts).sort()).toEqual([
      '@internal/sql-contract/types',
      '@prisma/orm-extension-arktype-json/codec-types',
      '@prisma/orm-framework/contract/types',
    ]);
  });

  it('emits today’s specifiers when no root is supplied', async () => {
    const withoutOption = await emit(contract(), stack, spi);
    const withInternalRoot = await emitFor(internalImportRoot);

    expect(withoutOption.contractDts).toBe(withInternalRoot.contractDts);
    expect(importedSpecifiers(withoutOption.contractDts).sort()).toEqual([
      '@internal/contract/types',
      '@internal/extension-arktype-json/codec-types',
      '@internal/sql-contract/types',
    ]);
  });
});
