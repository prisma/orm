import mongoAdapter from '@internal/adapter-mongo/control';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

function namespaceScalarTypeCodecIds(): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [name, output] of collectScalarTypeConstructors(stack.authoringContributions.type)) {
    result.set(name, output.codecId);
  }
  return result;
}

const REPRESENTATIVE_SCHEMA = `model sample {
  id        ObjectId @id @map("_id")
  name      String
  count     Int
  active    Boolean
  ratio     Float
  createdAt DateTime
  parentRef ObjectId
}
`;

const BSON_SCALARS_SCHEMA = `model post {
  id        ObjectId   @id @map("_id")
  views     Int64
  price     Decimal128
  thumbnail Binary
  meta      Json
}
`;

function emit(
  scalarTypeCodecIds: ReadonlyMap<string, string>,
  schema: string = REPRESENTATIVE_SCHEMA,
) {
  const { document, sources } = parse(schema, 'representative-schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToMongoContract({
    document,
    symbolTable,
    sources,
    scalarTypeCodecIds,
    controlMutationDefaults: {
      dataTypeEntries: {},
      defaultFunctionRegistry: new Map(),
    },
    codecLookup: stack.codecLookup,
    authoringContributions: stack.authoringContributions,
  });
}

// The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned literals
// below carry the parity claim forward — they are the exact
// {codecId, nativeType} pairs the retired map + codecLookup derivation produced.
describe('mongo scalar types derived from the unified namespace', () => {
  it('pins every base scalar to its {codecId, nativeType}', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'mongo/string@1', nativeType: 'string' },
      Int: { codecId: 'mongo/int32@1', nativeType: 'int' },
      Boolean: { codecId: 'mongo/bool@1', nativeType: 'bool' },
      DateTime: { codecId: 'mongo/date@1', nativeType: 'date' },
      ObjectId: { codecId: 'mongo/objectId@1', nativeType: 'objectId' },
      Float: { codecId: 'mongo/double@1', nativeType: 'double' },
      Int64: { codecId: 'mongo/int64@1', nativeType: 'long' },
      Decimal128: { codecId: 'mongo/decimal128@1', nativeType: 'decimal' },
      Binary: { codecId: 'mongo/binary@1', nativeType: 'binData' },
      Json: { codecId: 'mongo/json@1', nativeType: 'json' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'Binary',
      'Boolean',
      'DateTime',
      'Decimal128',
      'Float',
      'Int',
      'Int64',
      'Json',
      'ObjectId',
      'String',
    ]);
  });

  it('resolves ObjectId fields (incl. the mandated _id) through the derived map', () => {
    const result = emit(namespaceScalarTypeCodecIds());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      domain: {
        namespaces: {
          __unbound__: {
            models: {
              sample: {
                fields: {
                  _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                  parentRef: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                },
              },
            },
          },
        },
      },
    });
  });

  it('resolves Int64, Decimal128, Binary and Json to their codecs and BSON validator types', () => {
    const result = emit(namespaceScalarTypeCodecIds(), BSON_SCALARS_SCHEMA);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      domain: {
        namespaces: {
          __unbound__: {
            models: {
              post: {
                fields: {
                  views: { type: { kind: 'scalar', codecId: 'mongo/int64@1' } },
                  price: { type: { kind: 'scalar', codecId: 'mongo/decimal128@1' } },
                  thumbnail: { type: { kind: 'scalar', codecId: 'mongo/binary@1' } },
                  meta: { type: { kind: 'scalar', codecId: 'mongo/json@1' } },
                },
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          __unbound__: {
            entries: {
              collection: {
                post: {
                  validator: {
                    jsonSchema: {
                      properties: {
                        views: { bsonType: 'long' },
                        price: { bsonType: 'decimal' },
                        thumbnail: { bsonType: 'binData' },
                        meta: {},
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
