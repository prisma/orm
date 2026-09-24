import type { CodecLookup } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

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

const codecLookup: CodecLookup = {
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
  const { document, sources } = parse(SCHEMA, 'bson-scalars.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  const result = interpretPslDocumentToMongoContract({
    documents: [document],
    symbolTable,
    sources,
    scalarTypeCodecIds,
    controlMutationDefaults: { dataTypeEntries: {}, defaultFunctionRegistry: new Map() },
    codecLookup,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  return result.value;
}

describe('BSON scalar field types', () => {
  it('emits the codec id of each type', () => {
    const contract = interpretPost();
    expect(contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['Post']?.fields).toEqual({
      _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
      views: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/int64@1' } },
      price: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/decimal128@1' } },
      thumbnail: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/binary@1' } },
      meta: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/json@1' } },
      notes: { nullable: true, type: { kind: 'scalar', codecId: 'mongo/json@1' } },
    });
  });
});
