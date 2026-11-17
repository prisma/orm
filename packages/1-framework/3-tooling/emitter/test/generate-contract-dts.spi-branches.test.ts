import type { Contract } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { EmissionSpi } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const HASHES = {
  storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
  profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
};

function literalCodecLookup(): CodecLookup {
  return {
    get: () => undefined,
    renderOutputTypeFor: () => undefined,
    renderValueLiteralFor: (_id, value) =>
      typeof value === 'string'
        ? `"${value}"`
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : undefined,
  };
}

function makeEnumContract(opts: {
  valueSet: {
    readonly plane: 'domain' | 'storage';
    readonly namespaceId: string;
    readonly entityKind: 'enum' | 'valueSet';
    readonly entityName: string;
  };
  includeEnumBlock: boolean;
}): Contract {
  const post = {
    fields: {
      priority: {
        nullable: false,
        type: { kind: 'scalar' as const, codecId: 'pg/text@1' },
        valueSet: opts.valueSet,
        many: false,
      },
    },
    relations: {},
    storage: {},
  };
  const publicNs: Record<string, unknown> = { models: { Post: post } };
  if (opts.includeEnumBlock) {
    publicNs['enum'] = {
      Priority: {
        codecId: 'pg/text@1',
        members: [
          { name: 'Low', value: 'low' },
          { name: 'High', value: 'high' },
        ],
      },
    };
  }
  return createTestContract({ namespaces: { public: publicNs } });
}

describe('generateContractDts contract type', () => {
  it('writes profileHash on the line after meta, with no blank line between them', () => {
    const dts = generateContractDts(createTestContract(), createMockSpi(), [], HASHES);
    expect(dts).toMatch(/readonly meta: [^\n]*;\n {2}readonly profileHash: ProfileHash;/);
  });
});

describe('generateContractDts SPI hook plumbing', () => {
  it('omits extra storage exports when the SPI has no getStorageTypeExports hook', () => {
    const spi: EmissionSpi = createMockSpi();
    const dts = generateContractDts(createTestContract(), spi, [], HASHES);
    expect(dts).not.toContain('export type StorageColumnTypes');
    expect(dts).not.toContain('export type StorageColumnInputTypes');
  });

  it('inserts the SPI-provided storage exports when getStorageTypeExports returns a string', () => {
    const spi: EmissionSpi = createMockSpi({
      getStorageTypeExports: () =>
        ['export type StorageColumnTypes = {};', 'export type StorageColumnInputTypes = {};'].join(
          '\n',
        ),
    });
    const dts = generateContractDts(createTestContract(), spi, [], HASHES);
    expect(dts).toContain('export type StorageColumnTypes = {};');
    expect(dts).toContain('export type StorageColumnInputTypes = {};');
  });

  it('omits extra exports when getStorageTypeExports returns undefined', () => {
    const spi: EmissionSpi = createMockSpi({ getStorageTypeExports: () => undefined });
    const dts = generateContractDts(createTestContract(), spi, [], HASHES);
    expect(dts).not.toContain('export type StorageColumnTypes');
  });
});

describe('generateContractDts resolveStorageValueSet wiring', () => {
  // Without an override, the shared field type generic gives the field its codec type.
  const NO_OVERRIDES = 'type FieldTypeOverrides = {  };';

  const priorityResolver: EmissionSpi['resolveStorageValueSet'] = (_m, fieldName) =>
    fieldName === 'priority' ? { encodedValues: ['low', 'high'], codecId: 'pg/text@1' } : undefined;

  const PRIORITY_OVERRIDES =
    'type FieldTypeOverrides = { readonly public: { readonly models: { readonly Post: { readonly priority: { readonly output: "low" | "high"; readonly input: "low" | "high" } } } } };';

  it('narrows a field whose value set is in storage to the literal union supplied by the SPI resolver', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueSet',
        entityName: 'Priority',
      },
      includeEnumBlock: false,
    });
    const dts = generateContractDts(
      contract,
      createMockSpi({ resolveStorageValueSet: priorityResolver }),
      [],
      HASHES,
      undefined,
      literalCodecLookup(),
    );
    expect(dts).toContain(PRIORITY_OVERRIDES);
  });

  it('narrows a field that names a domain enum to its members without the SPI resolver', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'domain',
        namespaceId: 'public',
        entityKind: 'enum',
        entityName: 'Priority',
      },
      includeEnumBlock: true,
    });
    const dts = generateContractDts(
      contract,
      createMockSpi({ resolveStorageValueSet: () => undefined }),
      [],
      HASHES,
      undefined,
      literalCodecLookup(),
    );
    expect(dts).toContain(PRIORITY_OVERRIDES);
  });

  it('does not narrow a field whose value set is in storage when the SPI supplies no resolveStorageValueSet hook', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueSet',
        entityName: 'Priority',
      },
      includeEnumBlock: false,
    });
    const dts = generateContractDts(
      contract,
      createMockSpi(),
      [],
      HASHES,
      undefined,
      literalCodecLookup(),
    );
    expect(dts).toContain(NO_OVERRIDES);
  });

  it('falls back to the codec channel when the resolver returns undefined for the field', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'storage',
        namespaceId: 'public',
        entityKind: 'valueSet',
        entityName: 'Priority',
      },
      includeEnumBlock: true,
    });
    const dts = generateContractDts(
      contract,
      createMockSpi({ resolveStorageValueSet: () => undefined }),
      [],
      HASHES,
      undefined,
      literalCodecLookup(),
    );
    expect(dts).toContain(NO_OVERRIDES);
  });

  it('falls back to the codec channel when no codec lookup is supplied', () => {
    const contract = makeEnumContract({
      valueSet: {
        plane: 'domain',
        namespaceId: 'public',
        entityKind: 'enum',
        entityName: 'Priority',
      },
      includeEnumBlock: true,
    });
    const dts = generateContractDts(
      contract,
      createMockSpi({ resolveStorageValueSet: priorityResolver }),
      [],
      HASHES,
    );
    expect(dts).toContain(NO_OVERRIDES);
  });
});
