import {
  assembleDataTypeSupport,
  findAuthoringTypeChoiceCall,
  instantiateAuthoringTypeCall,
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
  ['BsonString', 'mongo/string@1'],
  ['Int32', 'mongo/int32@1'],
  ['Bool', 'mongo/bool@1'],
  ['ObjectId', 'mongo/objectId@1'],
  ['Double', 'mongo/double@1'],
  ['Int64BigInt', 'mongo/int64@1'],
  ['Int64Number', 'mongo/int64Number@1'],
  ['Decimal128', 'mongo/decimal128@1'],
  ['Binary', 'mongo/binary@1'],
] as const;

const deprecatedAliases = [['Int64', 'Int64BigInt']] as const;

const convenienceTypes = [
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'Bytes',
  'String',
  'Json',
];

describe('mongoScalarAuthoringTypes', () => {
  it('pins every base scalar as a zero-arg type constructor naming its codec', () => {
    expect(Object.keys(mongoScalarAuthoringTypes).sort()).toEqual(
      [
        ...expectedScalars.map(([name]) => name),
        'PlainJson',
        'Bson',
        'Vector',
        ...deprecatedAliases.map(([name]) => name),
        ...convenienceTypes,
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
    ['BsonString', 'string'],
    ['Int32', 'int'],
    ['Int64BigInt', 'long'],
    ['Int64Number', 'long'],
    ['Double', 'double'],
    ['Decimal128', 'decimal'],
    ['Bool', 'bool'],
    ['ObjectId', 'objectId'],
    ['Binary', 'binData'],
    ['Vector', 'array'],
    ['Int', 'int'],
    ['BigInt', 'long'],
    ['Float', 'double'],
    ['Decimal', 'decimal'],
    ['Boolean', 'bool'],
    ['Bytes', 'binData'],
    ['String', 'string'],
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
    expect(mongoScalarAuthoringTypes.PlainJson.output).toEqual({ codecId: 'mongo/json@1' });
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

const convenienceRows = [
  ['Int', [], 'Int32', 'mongo/int32@1'],
  ['Int', ['int'], 'Int32', 'mongo/int32@1'],
  ['BigInt', [], 'Int64BigInt', 'mongo/int64@1'],
  ['BigInt', ['bigint', 'long'], 'Int64BigInt', 'mongo/int64@1'],
  ['BigInt', ['number'], 'Int64Number', 'mongo/int64Number@1'],
  ['BigInt', ['number', 'long'], 'Int64Number', 'mongo/int64Number@1'],
  ['Float', [], 'Double', 'mongo/double@1'],
  ['Float', ['double'], 'Double', 'mongo/double@1'],
  ['Decimal', [], 'Decimal128', 'mongo/decimal128@1'],
  ['Decimal', ['decimal'], 'Decimal128', 'mongo/decimal128@1'],
  ['Boolean', [], 'Bool', 'mongo/bool@1'],
  ['Boolean', ['bool'], 'Bool', 'mongo/bool@1'],
  ['Bytes', [], 'Binary', 'mongo/binary@1'],
  ['Bytes', ['binData'], 'Binary', 'mongo/binary@1'],
  ['String', [], 'BsonString', 'mongo/string@1'],
  ['String', ['string'], 'BsonString', 'mongo/string@1'],
  ['Json', ['bson'], 'PlainJson', 'mongo/json@1'],
  ['Json', [], 'PlainJson', 'mongo/json@1'],
] as const;

describe('the MongoDB scalar convenience types', () => {
  it('are type choices, none deprecated', () => {
    expect(
      Object.fromEntries(
        convenienceTypes.map((name) => {
          const descriptor =
            mongoScalarAuthoringTypes[name as keyof typeof mongoScalarAuthoringTypes];
          return [name, [descriptor.kind, 'deprecated' in descriptor]];
        }),
      ),
    ).toEqual(Object.fromEntries(convenienceTypes.map((name) => [name, ['typeChoice', false]])));
  });

  it.each(convenienceRows)('%s(%j) is %s, on %s', (name, args, explicit, codecId) => {
    expect(instantiateAuthoringTypeCall(mongoScalarTypeConstructors, name, args)).toEqual({
      codecId,
    });
    expect(instantiateAuthoringTypeCall(mongoScalarTypeConstructors, explicit, [])).toEqual({
      codecId,
    });
  });

  it.each([
    ['Int', ['long']],
    ['BigInt', ['string']],
    ['BigInt', ['number', 'int']],
    ['Json', ['string']],
    ['String', ['bson']],
  ])('refuse %s(%j), which no row lists', (name, args) => {
    expect(() => instantiateAuthoringTypeCall(mongoScalarTypeConstructors, name, args)).toThrow();
  });

  it.each([
    ['Int32', { path: ['Int'], args: [] }],
    ['Int64BigInt', { path: ['BigInt'], args: [] }],
    ['Int64Number', { path: ['BigInt'], args: [{ name: 'as', value: 'number' }] }],
    ['Double', { path: ['Float'], args: [] }],
    ['Decimal128', { path: ['Decimal'], args: [] }],
    ['Bool', { path: ['Boolean'], args: [] }],
    ['Binary', { path: ['Bytes'], args: [] }],
    ['BsonString', { path: ['String'], args: [] }],
    ['PlainJson', { path: ['Json'], args: [] }],
  ])('write %s as the convenience call %j', (explicit, call) => {
    expect(
      findAuthoringTypeChoiceCall({
        namespace: mongoScalarTypeConstructors,
        call: { path: [explicit], args: [] },
      }),
    ).toEqual({ ...call, becomes: { path: [explicit], args: [] } });
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
