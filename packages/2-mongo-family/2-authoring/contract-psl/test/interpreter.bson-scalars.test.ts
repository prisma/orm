import type { CodecLookup, CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map([
  ['ObjectId', 'mongo/objectId@1'],
  ['Int64', 'mongo/int64@1'],
  ['Decimal128', 'mongo/decimal128@1'],
  ['Binary', 'mongo/binary@1'],
  ['Json', 'mongo/json@1'],
]);

const targetTypes: Record<string, readonly string[]> = {
  'mongo/objectId@1': ['objectId'],
  'mongo/int64@1': ['long'],
  'mongo/decimal128@1': ['decimal'],
  'mongo/binary@1': ['binData'],
  'mongo/json@1': [],
};

const codecLookup: CodecLookupWithDescriptors = {
  get(id: string) {
    if (!targetTypes[id]) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => targetTypes[id],
  renderOutputTypeFor: () => undefined,
  descriptorFor: () => undefined,
};

const SCHEMA = `model Post {
  id        ObjectId    @id @map("_id")
  views     Int64
  price     Decimal128
  thumbnail Binary
  meta      Json
  notes     Json?
}
`;

function interpretPost() {
  const result = interpretMongoContract(
    SCHEMA,
    {
      scalarTypeCodecIds,
      controlMutationDefaults: { defaultFunctionRegistry: new Map() },
      codecLookup,
    },
    'bson-scalars.prisma',
  );
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  return result.value;
}

describe('BSON scalar field types', () => {
  it('emits the codec id of each type', () => {
    const contract = interpretPost();
    expect(contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['Post']?.fields).toEqual({
      _id: { many: false, nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
      views: { many: false, nullable: false, type: { kind: 'scalar', codecId: 'mongo/int64@1' } },
      price: {
        many: false,
        nullable: false,
        type: { kind: 'scalar', codecId: 'mongo/decimal128@1' },
      },
      thumbnail: {
        many: false,
        nullable: false,
        type: { kind: 'scalar', codecId: 'mongo/binary@1' },
      },
      meta: { many: false, nullable: false, type: { kind: 'scalar', codecId: 'mongo/json@1' } },
      notes: { many: false, nullable: true, type: { kind: 'scalar', codecId: 'mongo/json@1' } },
    });
  });
});
