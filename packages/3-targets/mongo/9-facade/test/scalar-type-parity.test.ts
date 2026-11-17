import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { mongoContextInput } from '@internal/mongo-contract-psl/test';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

const REPRESENTATIVE_SCHEMA = `model sample {
  id        ObjectId @id @map("_id")
  name      String
  count     Int32
  active    Bool
  ratio     Double
  createdAt DateTime
  parentRef ObjectId
}
`;

const BSON_SCALARS_SCHEMA = `model post {
  id        ObjectId   @id @map("_id")
  views     Int64
  hits      Int64Number
  price     Decimal128
  thumbnail Binary
  meta      Json
  raw       Bson
}
`;

function emit(schema: string = REPRESENTATIVE_SCHEMA) {
  const bound = bindPslSchema(schema, {
    sourceId: 'representative-schema.prisma',
    context: contractSourceContextFromControlStack(stack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToMongoContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...mongoContextInput(bound.context),
    }),
    bound.seedDiagnostics,
  );
}

// The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned literals
// below carry the parity claim forward — they are the exact
// {codecId} pairs the retired map + codecLookup derivation produced.
describe('mongo scalar types derived from the unified namespace', () => {
  it('pins every base scalar to its {codecId}', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'mongo/string@1' },
      Int32: { codecId: 'mongo/int32@1' },
      Bool: { codecId: 'mongo/bool@1' },
      ObjectId: { codecId: 'mongo/objectId@1' },
      Double: { codecId: 'mongo/double@1' },
      Int64: { codecId: 'mongo/int64@1' },
      Int64Number: { codecId: 'mongo/int64Number@1' },
      Decimal128: { codecId: 'mongo/decimal128@1' },
      Binary: { codecId: 'mongo/binary@1' },
      Json: { codecId: 'mongo/json@1' },
      Bson: { codecId: 'mongo/bson@1' },
      Vector: { codecId: 'mongo/vector@1' },
      Int: { codecId: 'mongo/int32@1' },
      Float: { codecId: 'mongo/double@1' },
      Boolean: { codecId: 'mongo/bool@1' },
      DateJsDate: { codecId: 'mongo/date@1' },
      DateInstant: { codecId: 'mongo/date-instant@1' },
      DateInstantString: { codecId: 'mongo/date-instant-string@1' },
      DateString: { codecId: 'mongo/date-string@1' },
      DateTemporal: { codecId: 'mongo/date-temporal@1' },
      TimeString: { codecId: 'mongo/time-string@1' },
      TimeTemporal: { codecId: 'mongo/time-temporal@1' },
      DurationString: { codecId: 'mongo/duration-string@1' },
      DateTime: { codecId: 'mongo/date@1' },
      Date: { codecId: 'mongo/date-string@1' },
      Time: { codecId: 'mongo/time-string@1' },
      Duration: { codecId: 'mongo/duration-string@1' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'Binary',
      'Bool',
      'Boolean',
      'Bson',
      'Date',
      'DateInstant',
      'DateInstantString',
      'DateJsDate',
      'DateString',
      'DateTemporal',
      'DateTime',
      'Decimal128',
      'Double',
      'Duration',
      'DurationString',
      'Float',
      'Int',
      'Int32',
      'Int64',
      'Int64Number',
      'Json',
      'ObjectId',
      'String',
      'Time',
      'TimeString',
      'TimeTemporal',
      'Vector',
    ]);
  });

  it('resolves Vector, with and without a length', () => {
    const result = emit(`model doc {
  id        ObjectId @id @map("_id")
  embedding Vector(3)
  plain     Vector
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domain.namespaces['__unbound__']?.models['doc']?.fields).toMatchObject({
      embedding: { type: { kind: 'scalar', codecId: 'mongo/vector@1', typeParams: { length: 3 } } },
      plain: { type: { kind: 'scalar', codecId: 'mongo/vector@1' } },
    });
  });

  it('resolves ObjectId fields (incl. the one stored as _id) through the derived map', () => {
    const result = emit();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      domain: {
        namespaces: {
          __unbound__: {
            models: {
              sample: {
                fields: {
                  id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                  parentRef: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                },
                storage: { fields: { id: { field: '_id' } } },
              },
            },
          },
        },
      },
    });
  });

  it('resolves Int64, Int64Number, Decimal128, Binary, Json and Bson to their codecs and BSON validator types', () => {
    const result = emit(BSON_SCALARS_SCHEMA);

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
                  hits: { type: { kind: 'scalar', codecId: 'mongo/int64Number@1' } },
                  price: { type: { kind: 'scalar', codecId: 'mongo/decimal128@1' } },
                  thumbnail: { type: { kind: 'scalar', codecId: 'mongo/binary@1' } },
                  meta: { type: { kind: 'scalar', codecId: 'mongo/json@1' } },
                  raw: { type: { kind: 'scalar', codecId: 'mongo/bson@1' } },
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
                        hits: { bsonType: 'long' },
                        price: { bsonType: 'decimal' },
                        thumbnail: { bsonType: 'binData' },
                        meta: {
                          bsonType: [
                            'object',
                            'array',
                            'string',
                            'double',
                            'int',
                            'long',
                            'bool',
                            'null',
                          ],
                        },
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
    expect(result.value.storage).toHaveProperty(
      [
        'namespaces',
        '__unbound__',
        'entries',
        'collection',
        'post',
        'validator',
        'jsonSchema',
        'properties',
        'raw',
      ],
      {},
    );
  });
});

describe('deprecated Mongo scalar names through the PSL contract source', () => {
  function interpretWith(schema: string) {
    const warnings: ContractSourceDiagnostic[] = [];
    const context = contractSourceContextFromControlStack(stack, {
      reportWarning: (diagnostic: ContractSourceDiagnostic) => {
        warnings.push(diagnostic);
      },
    });
    const bound = bindPslSchema(schema, { sourceId: 'schema.prisma', context });
    const result = withSeedDiagnostics(
      interpretPslDocumentToMongoContract({
        documents: bound.documents,
        sources: bound.sources,
        symbolTable: bound.symbolTable,
        binder: bound.binder,
        ...mongoContextInput(bound.context),
      }),
      bound.seedDiagnostics,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    const json = JSON.stringify(
      mongoTargetDescriptor.contractSerializer.serializeContract(
        result.value as Parameters<
          typeof mongoTargetDescriptor.contractSerializer.serializeContract
        >[0],
      ),
    );
    return { json, warnings };
  }

  it('emits the same contract.json for the deprecated and the current names, warning once per deprecated use', () => {
    const current = interpretWith(REPRESENTATIVE_SCHEMA);
    const deprecated = interpretWith(
      REPRESENTATIVE_SCHEMA.replace('Int32', 'Int')
        .replace('Bool', 'Boolean')
        .replace('Double', 'Float'),
    );

    expect(deprecated.json).toBe(current.json);
    expect(current.warnings).toEqual([]);
    expect(deprecated.warnings.map((warning) => [warning.code, warning.severity])).toEqual([
      ['PSL_DEPRECATED_SCALAR_NAME', 'warning'],
      ['PSL_DEPRECATED_SCALAR_NAME', 'warning'],
      ['PSL_DEPRECATED_SCALAR_NAME', 'warning'],
    ]);
  });
});
