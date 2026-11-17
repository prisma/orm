import {
  assembleDataTypeSupport,
  instantiateAuthoringTypeConstructorFromValues,
  readWrittenValueAs,
} from '@internal/framework-components/authoring';
import { dataTypeId } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoScalarAuthoringTypes, mongoScalarTypeConstructors } from '../src/core/authoring';
import { mongoDescriptorById } from '../src/core/codecs';
import { mongoBson, mongoJson } from '../src/core/data-types';
import { mongoTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mongoTargetPack from '../src/exports/pack';

const expectedScalars = [
  ['String', 'mongo/string@1'],
  ['Int32', 'mongo/int32@1'],
  ['Bool', 'mongo/bool@1'],
  ['ObjectId', 'mongo/objectId@1'],
  ['Double', 'mongo/double@1'],
  ['Int64', 'mongo/int64@1'],
  ['Int64Number', 'mongo/int64Number@1'],
  ['Decimal128', 'mongo/decimal128@1'],
  ['Binary', 'mongo/binary@1'],
] as const;

const deprecatedAliases = [
  ['Int', 'Int32'],
  ['Float', 'Double'],
  ['Boolean', 'Bool'],
] as const;

describe('mongoScalarAuthoringTypes', () => {
  it('pins every base scalar as a zero-arg type constructor naming its codec', () => {
    expect(Object.keys(mongoScalarAuthoringTypes).sort()).toEqual(
      [
        ...expectedScalars.map(([name]) => name),
        'Json',
        'Bson',
        'Vector',
        ...deprecatedAliases.map(([name]) => name),
      ].sort(),
    );
    for (const [name, codecId] of expectedScalars) {
      expect(mongoScalarAuthoringTypes[name]).toEqual({
        kind: 'typeConstructor',
        documentation: expect.stringMatching(/\S/),
        output: { codecId },
      });
    }
  });

  it.each(deprecatedAliases)(
    'keeps %s as a deprecated alias of %s with the same codec and native type',
    (alias, replacement) => {
      expect(mongoScalarAuthoringTypes[alias]).toEqual({
        ...mongoScalarAuthoringTypes[replacement],
        documentation: expect.stringContaining(`Deprecated: use ${replacement}.`),
        deprecated: { replacement },
      });
    },
  );

  it.each([
    ['String', 'string'],
    ['Int32', 'int'],
    ['Int64', 'long'],
    ['Double', 'double'],
    ['Decimal128', 'decimal'],
    ['Bool', 'bool'],
    ['ObjectId', 'objectId'],
    ['Binary', 'binData'],
    ['Vector', 'array'],
  ] as const)('documents %s by the BSON type it is stored as', (name, bsonType) => {
    expect(mongoScalarAuthoringTypes[name].documentation).toContain(`stored as BSON ${bsonType}`);
  });

  it('pins Json to the json native type and the JSON-representable BSON types', () => {
    expect(mongoDescriptorById('mongo/json@1')?.dataType).toBe(mongoJson.id);
    expect(mongoJson.mongo.bsonTypes).toEqual([
      'object',
      'array',
      'string',
      'double',
      'int',
      'long',
      'bool',
      'null',
    ]);
    expect(mongoScalarAuthoringTypes.Json.output).toEqual({ codecId: 'mongo/json@1' });
  });

  it('pins Bson, whose codec declares no BSON type, to the bson native type', () => {
    expect(mongoDescriptorById('mongo/bson@1')?.dataType).toBe(mongoBson.id);
    expect(mongoBson.mongo.bsonTypes).toEqual([]);
    expect(mongoScalarAuthoringTypes.Bson).toEqual({
      kind: 'typeConstructor',
      documentation: expect.stringContaining('the collection validator does not constrain it'),
      output: { codecId: 'mongo/bson@1' },
    });
  });

  it('gives Vector its length as a type parameter, and none when it is left out', () => {
    const paramsSchema = mongoDescriptorById('mongo/vector@1')?.paramsSchema;
    const { Vector } = mongoScalarAuthoringTypes;
    const instanceOf = (args: readonly unknown[]) => {
      const result = instantiateAuthoringTypeConstructorFromValues(Vector, args, paramsSchema);
      return result.ok ? result.value : undefined;
    };
    expect({
      withLength: instanceOf([3]),
      withoutLength: instanceOf([]),
      zero: instanceOf([0]),
    }).toEqual({
      withLength: { codecId: 'mongo/vector@1', typeParams: { length: 3 } },
      withoutLength: { codecId: 'mongo/vector@1' },
      zero: undefined,
    });
  });

  it('is contributed by the target, beside the temporal type aliases', () => {
    const { temporal, ...scalars } = mongoTargetDescriptorMeta.authoring.type;
    expect({ scalars, temporal: Object.keys(temporal) }).toEqual({
      scalars: mongoScalarTypeConstructors,
      temporal: ['CreatedAt', 'UpdatedAt'],
    });
  });
});

describe('the value argument types the MongoDB pack declares', () => {
  it('reads a mongo/int32 argument as the declared number parameter', () => {
    const { support } = assembleDataTypeSupport([mongoTargetPack], () => undefined);
    const read = readWrittenValueAs(support, dataTypeId('mongo/int32'), {
      kind: 'number',
      text: '3',
    });
    const parameter: NonNullable<
      (typeof mongoTargetPack)['__dataTypeArguments']
    >['mongo/int32']['parameter'] = 3;
    expect(read.ok && read.value.value).toBe(parameter);
  });
});
