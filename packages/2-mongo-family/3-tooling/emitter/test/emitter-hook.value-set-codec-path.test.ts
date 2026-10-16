import { type Contract, type ContractModelBase, coreHash } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import type { CodecLookup } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import { createMongoContract } from './fixtures/create-mongo-contract';

const NON_IDENTITY_CODEC_ID = 'test/level@1';
const LEVEL_BY_INDEX = ['low', 'high', 'urgent'] as const;

// A non-identity codec: encodes to ints 0|1|2 (the value-set's stored form) but its output type is
// the string literals "low"|"high"|"urgent". `renderValueLiteralFor` decodes the encoded int, then
// renders the decoded literal — so the emitted type is the codec OUTPUT, not the encoded value.
const nonIdentityCodecLookup: CodecLookup = {
  get: () => undefined,
  renderOutputTypeFor: (id) => (id === NON_IDENTITY_CODEC_ID ? 'Level' : undefined),
  renderValueLiteralFor: (id, value) => {
    if (id !== NON_IDENTITY_CODEC_ID || typeof value !== 'number') return undefined;
    const decoded = LEVEL_BY_INDEX[value];
    return decoded === undefined ? undefined : `"${decoded}"`;
  },
};

const testHashes = { storageHash: 'test', profileHash: 'test' };

const levelField = {
  nullable: false,
  many: false,
  type: { kind: 'scalar', codecId: NON_IDENTITY_CODEC_ID },
  valueSet: {
    plane: 'domain',
    entityKind: 'enum',
    namespaceId: UNBOUND_NAMESPACE_ID,
    entityName: 'Level',
  },
} as const;

const itemModel: ContractModelBase = {
  fields: { level: levelField },
  relations: {},
  storage: { collection: 'items' },
} as unknown as ContractModelBase;

function contractWithEncodedValueSet(): Contract {
  const base = createMongoContract({ models: { Item: itemModel } });
  const namespace = base.domain.namespaces[UNBOUND_NAMESPACE_ID];
  const domain = {
    namespaces: {
      ...base.domain.namespaces,
      [UNBOUND_NAMESPACE_ID]: {
        ...namespace,
        models: namespace?.models ?? {},
        // Encoded form: integers. The codec decodes them to string literals.
        enum: {
          Level: {
            codecId: NON_IDENTITY_CODEC_ID,
            members: LEVEL_BY_INDEX.map((name, value) => ({ name, value })),
          },
        },
      },
    },
  };
  const storage = {
    storageHash: coreHash('test'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'mongo-namespace' as const,
        entries: {
          collection: {},
          // Encoded form: integers. The codec decodes them to string literals.
          valueSet: { Level: { kind: 'valueSet', values: [0, 1, 2] } },
        },
      },
    },
  };
  return { ...base, domain, storage: storage as Contract['storage'] };
}

function overridesOf(dts: string): string | undefined {
  return dts.match(/^type FieldTypeOverrides = (.*);$/m)?.[1];
}

describe('mongo emit typing routes through the codec seam (not a raw value print)', () => {
  it("types a value-set field as the codec's decoded output, not the encoded values", () => {
    const dts = generateContractDts(
      contractWithEncodedValueSet(),
      mongoEmission,
      [],
      testHashes,
      undefined,
      nonIdentityCodecLookup,
    );

    // Codec OUTPUT (decoded literals), proving the value flowed through
    // renderValueSetType -> renderValueLiteralFor, not a raw print of the encoded values.
    expect(overridesOf(dts)).toBe(
      '{ readonly __unbound__: { readonly models: { readonly Item: { readonly level: { readonly output: "low" | "high" | "urgent"; readonly input: "low" | "high" | "urgent" } } } } }',
    );
  });

  it('falls back to the codec output type when the lookup renders no literal', () => {
    const noLiteralLookup: CodecLookup = {
      ...nonIdentityCodecLookup,
      renderValueLiteralFor: () => undefined,
    };
    const dts = generateContractDts(
      contractWithEncodedValueSet(),
      mongoEmission,
      [],
      testHashes,
      undefined,
      noLiteralLookup,
    );
    // No override: the shared generic types the field by its codec, never the raw encoded ints.
    expect(overridesOf(dts)).toBe('{  }');
  });
});
