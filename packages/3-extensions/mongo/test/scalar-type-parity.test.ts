import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { interpretPslDocumentToMongoContract } from '@internal/mongo-contract-psl';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { buildSymbolTable } from '@internal/psl-parser';
import { hasPslInterpreter } from '@internal/psl-parser/interpret';
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
  count     Int32
  active    Bool
  ratio     Double
  createdAt Date
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
    documents: [document],
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
      Int32: { codecId: 'mongo/int32@1', nativeType: 'int' },
      Bool: { codecId: 'mongo/bool@1', nativeType: 'bool' },
      Date: { codecId: 'mongo/date@1', nativeType: 'date' },
      ObjectId: { codecId: 'mongo/objectId@1', nativeType: 'objectId' },
      Double: { codecId: 'mongo/double@1', nativeType: 'double' },
      Int64: { codecId: 'mongo/int64@1', nativeType: 'long' },
      Decimal128: { codecId: 'mongo/decimal128@1', nativeType: 'decimal' },
      Binary: { codecId: 'mongo/binary@1', nativeType: 'binData' },
      Json: { codecId: 'mongo/json@1', nativeType: 'json' },
      Int: { codecId: 'mongo/int32@1', nativeType: 'int' },
      Float: { codecId: 'mongo/double@1', nativeType: 'double' },
      Boolean: { codecId: 'mongo/bool@1', nativeType: 'bool' },
      DateTime: { codecId: 'mongo/date@1', nativeType: 'date' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'Binary',
      'Bool',
      'Boolean',
      'Date',
      'DateTime',
      'Decimal128',
      'Double',
      'Float',
      'Int',
      'Int32',
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

describe('deprecated Mongo scalar names through the PSL contract source', () => {
  function interpretWith(schema: string) {
    const { document, sources } = parse(schema, 'schema.prisma');
    const { symbolTable } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
    });
    const warnings: ContractSourceDiagnostic[] = [];
    const source = mongoContract('schema.prisma').source;
    if (!hasPslInterpreter(source)) throw new Error('mongoContract has an interpreter');
    const result = source.interpret(
      { documents: [document], sources, symbolTable },
      {
        composedExtensions: [],
        composedExtensionContracts: new Map(),
        authoringContributions: stack.authoringContributions,
        codecLookup: stack.codecLookup,
        dataTypeLookup: stack.dataTypeLookup,
        controlMutationDefaults: stack.controlMutationDefaults,
        resolvedInputs: [],
        capabilities: stack.capabilities,
        reportWarning: (diagnostic) => {
          warnings.push(diagnostic);
        },
      },
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
        .replace('Double', 'Float')
        .replace('Date', 'DateTime'),
    );

    expect(deprecated.json).toBe(current.json);
    expect(current.warnings).toEqual([]);
    expect(deprecated.warnings.map((warning) => [warning.code, warning.severity])).toEqual([
      ['PSL_DEPRECATED_SCALAR_NAME', 'warning'],
      ['PSL_DEPRECATED_SCALAR_NAME', 'warning'],
      ['PSL_DEPRECATED_SCALAR_NAME', 'warning'],
      ['PSL_DEPRECATED_SCALAR_NAME', 'warning'],
    ]);
  });
});
