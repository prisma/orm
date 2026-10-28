import { buildEnumsMapForNamespace } from '@internal/contract/enum-accessor';
import type { JsonValue } from '@internal/contract/types';
import { type EnumTypeHandle, enumType } from '@internal/contract-authoring';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { jsonValue, mapBlock } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const textType = mongoDataType('test/text', { read: (json) => json, bsonTypes: ['string'] });

function textCodec(
  id: string,
  toStored: (value: unknown) => JsonValue,
  fromStored: (json: JsonValue) => unknown,
): Codec {
  return {
    id,
    dataType: textType,
    toWire: async (v: unknown) => v,
    fromWire: async (w: unknown) => w,
    toDataTypeValue: (value) => textType.valueFrom(toStored(value), {}),
    fromDataTypeValue: (value) => fromStored(value.value),
  };
}

const prefixedCodec = textCodec(
  'test/prefixed@1',
  (v) => `s:${String(v)}`,
  (j) => String(j).slice('s:'.length),
);

const testCodecs = [
  prefixedCodec,
  textCodec(
    'test/refusing@1',
    (v) => {
      if (v === 'bad') throw new Error('bad is not allowed');
      return String(v);
    },
    (j) => j,
  ),
  textCodec(
    'test/shouting@1',
    (v) => String(v).toUpperCase(),
    (j) => j,
  ),
];

const codecLookup: CodecLookupWithDescriptors = {
  get: (id) => testCodecs.find((codec) => codec.id === id) ?? mongoCodecLookup.get(id),
  descriptorFor: (id) =>
    testCodecs.some((codec) => codec.id === id)
      ? ({
          codecId: id,
          dataType: 'test/text',
          traits: ['equality'],
        } as unknown as AnyCodecDescriptor)
      : mongoCodecLookup.descriptorFor(id),
  renderOutputTypeFor: () => undefined,
};

const dataTypeLookup = createDataTypeLookup([
  mongoDataType('mongo/objectid', { read: (json) => json, bsonTypes: ['objectId'] }),
  textType,
]);

const SCHEMA = `enum Status {
  Active = "active"
  Paused = "paused"
}

model Job {
  id     ObjectId @id @map("_id")
  status Status
}
`;

/** Interprets `SCHEMA` with an enum factory that returns `handle`, as a factory that reads the block its own way would. */
function interpretWithEnum(handle: EnumTypeHandle) {
  return interpretMongoContract(SCHEMA, {
    scalarTypes: new Map([['ObjectId', 'mongo/objectId@1']]),
    defaultFunctionRegistry: new Map(),
    codecLookup,
    dataTypes: { entries: {}, lookup: dataTypeLookup, dataTypeOfCodec: () => undefined },
    authoringContributions: {
      type: {},
      modelAttributes: {},
      entityTypes: {
        enum: { kind: 'entity', discriminator: 'enum', output: { factory: () => handle } },
      },
      pslBlockDescriptors: {
        enum: {
          kind: 'pslBlock',
          keyword: 'enum',
          discriminator: 'enum',
          name: { required: true },
          spec: () =>
            mapBlock({
              value: { type: jsonValue(), documentation: 'The member value.' },
              allowBare: true,
            }),
        },
      },
    },
  });
}

function statusEnum(codecId: string, active = 'active', paused = 'paused') {
  return enumType(
    'Status',
    { codecId },
    { name: 'Active', value: active },
    { name: 'Paused', value: paused },
  );
}

function interpretPrefixedEnum() {
  const result = interpretWithEnum(statusEnum('test/prefixed@1'));
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  return result.value;
}

function diagnosticsOf(handle: EnumTypeHandle) {
  const result = interpretWithEnum(handle);
  if (result.ok) throw new Error('Expected the interpretation to fail');
  return result.failure.diagnostics.map(({ code, message, sourceId, span }) => ({
    code,
    message,
    sourceId,
    line: span?.start.line,
  }));
}

describe('Mongo PSL enum members', () => {
  it('are written in their stored form, the value the codec gives for each decoded value', () => {
    const contract = interpretPrefixedEnum();
    const storage = contract.storage as unknown as {
      namespaces: Record<
        string,
        { entries: { valueSet: Record<string, { values: readonly unknown[] }> } }
      >;
    };

    expect({
      members: contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.enum?.['Status']?.members,
      valueSet: storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.valueSet['Status']?.values,
    }).toEqual({
      members: [
        { name: 'Active', value: 's:active' },
        { name: 'Paused', value: 's:paused' },
      ],
      valueSet: ['s:active', 's:paused'],
    });
  });

  it('decode back to the authored values through the enum accessor', () => {
    const contract = interpretPrefixedEnum();
    const enums = buildEnumsMapForNamespace(
      contract.domain,
      UNBOUND_NAMESPACE_ID,
      () => prefixedCodec,
    );

    expect(enums['Status']?.values).toEqual(['active', 'paused']);
  });

  it('reports a member its codec refuses, at the member', () => {
    expect(diagnosticsOf(statusEnum('test/refusing@1', 'active', 'bad'))).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Status" member "Paused" was rejected by codec "test/refusing@1": bad is not allowed',
        sourceId: 'schema.prisma',
        line: 3,
      },
    ]);
  });

  it('reports a member its codec reads back as another value, with the value to write', () => {
    expect(diagnosticsOf(statusEnum('test/shouting@1'))).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Status" member "Active" is written "active", but its codec stores "ACTIVE". Write the member as "ACTIVE".',
        sourceId: 'schema.prisma',
        line: 2,
      },
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Status" member "Paused" is written "paused", but its codec stores "PAUSED". Write the member as "PAUSED".',
        sourceId: 'schema.prisma',
        line: 3,
      },
    ]);
  });

  it('reports an enum codec no pack provides, at the enum', () => {
    expect(diagnosticsOf(statusEnum('test/missing@1'))).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Status" uses codec "test/missing@1", which no pack in the contract provides',
        sourceId: 'schema.prisma',
        line: 1,
      },
    ]);
  });
});
