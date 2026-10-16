import type { TypesImportSpec } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const HASHES = {
  storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
  profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
};

const CODEC_TYPES: TypesImportSpec = {
  package: '@internal/demo/codec-types',
  named: 'CodecTypes',
  alias: 'DemoTypes',
};

const VECTOR: TypesImportSpec = {
  package: '@internal/demo/codec-types',
  named: 'Vector',
  alias: 'Vector',
};

function importLines(dts: string): string {
  return dts.slice(0, dts.indexOf('export type'));
}

describe('generateContractDts codec type imports', () => {
  it('leaves out a helper type the contract does not use', () => {
    const dts = generateContractDts(
      createTestContract(),
      createMockSpi(),
      [CODEC_TYPES, VECTOR],
      HASHES,
    );

    expect(importLines(dts)).toContain('CodecTypes as DemoTypes');
    expect(importLines(dts)).not.toMatch(/\bVector\b/);
  });

  it('imports a helper type the contract uses', () => {
    const spi = createMockSpi({
      getStorageTypeExports: () => 'export type Embedding = Vector<3>;',
    });

    const dts = generateContractDts(createTestContract(), spi, [CODEC_TYPES, VECTOR], HASHES);

    expect(importLines(dts)).toMatch(/\bVector\b/);
  });
});

describe('generateContractDts parameterized output types', () => {
  const TYPE_FUNCTION: TypesImportSpec = {
    package: '@internal/demo/codec-types',
    named: 'ParameterizedOutputTypesForTypeParams',
    alias: 'DemoParameterizedOutputTypes',
  };

  it('declares the union of the stack type functions, and imports what it names', () => {
    const dts = generateContractDts(createTestContract(), createMockSpi(), [CODEC_TYPES], HASHES, {
      parameterizedOutputTypeImports: [TYPE_FUNCTION],
    });

    expect(dts).toContain('type ParameterizedOutputTypeFunctions = DemoParameterizedOutputTypes;');
    expect(importLines(dts)).toContain(
      'ParameterizedOutputTypesForTypeParams as DemoParameterizedOutputTypes',
    );
  });

  it('declares the union as never when the stack declares no type function', () => {
    const dts = generateContractDts(createTestContract(), createMockSpi(), [CODEC_TYPES], HASHES);

    expect(dts).toContain('type ParameterizedOutputTypeFunctions = never;');
  });
});

describe('generateContractDts field type maps', () => {
  const contract = createTestContract({
    namespaces: {
      public: {
        models: {
          User: {
            fields: {
              id: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'demo/char@1', typeParams: { length: 24 } },
                many: false,
              },
              address: {
                nullable: true,
                type: { kind: 'valueObject', name: 'Address' },
                many: false,
              },
            },
            relations: {},
            storage: {},
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'demo/text@1' } },
            },
          },
        },
      },
    },
  });

  it('applies the shared generic to the contract domain, with no override for fields the generic types itself', () => {
    const dts = generateContractDts(contract, createMockSpi(), [CODEC_TYPES], HASHES);

    expect(dts).toContain('type FieldTypeOverrides = {  };');
    expect(dts).not.toContain('ValueObjectFieldTypeOverrides');
    expect(dts).toContain(
      "export type FieldOutputTypes = FieldTypesFromDomain<ContractBase['domain']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, \"output\">;",
    );
    expect(dts).toContain(
      "export type FieldInputTypes = FieldTypesFromDomain<ContractBase['domain']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, \"input\">;",
    );
    expect(dts).toMatch(/\n {2}FieldTypesFromDomain,\n/);
  });

  it('types each value object alias through the shared generic', () => {
    const dts = generateContractDts(contract, createMockSpi(), [CODEC_TYPES], HASHES);

    expect(dts).toContain(
      'export type AddressOutput = ValueObjectOutputTypes["public"]["Address"];',
    );
    expect(dts).toMatch(/\n {2}ValueObjectTypesFromDomain,\n/);
  });

  it('types the fields of a Models member by indexing FieldOutputTypes', () => {
    const dts = generateContractDts(contract, createMockSpi(), [CODEC_TYPES], HASHES);

    expect(dts).toContain('id: FieldOutputTypes["public"]["User"]["id"];');
    expect(dts).toContain('address: FieldOutputTypes["public"]["User"]["address"];');
  });
});
