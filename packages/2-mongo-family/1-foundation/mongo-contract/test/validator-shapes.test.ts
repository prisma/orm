import { describe, expect, it } from 'vitest';
import {
  propertyBsonTypesOf,
  sameKindOfDocumentIn,
  validatorDocumentShapesOf,
  validatorFieldNamesOf,
  validatorRootShapesOf,
} from '../src/validator-shapes';

const user = {
  bsonType: 'object',
  required: ['_id', 'email'],
  properties: { _id: { bsonType: 'objectId' }, email: { bsonType: 'string' } },
  additionalProperties: false,
};
const task = {
  bsonType: 'object',
  required: ['_id', 'type'],
  properties: { _id: { bsonType: 'objectId' }, type: { bsonType: 'string' } },
  oneOf: [
    {
      required: ['severity', 'type'],
      properties: { type: { enum: ['bug'] }, severity: { bsonType: 'int' } },
      additionalProperties: false,
    },
  ],
};

describe('validatorRootShapesOf', () => {
  it('reads one root model with its variants', () => {
    expect(validatorRootShapesOf(task)).toEqual([
      {
        properties: task.properties,
        required: ['_id', 'type'],
        closed: false,
        variants: [
          {
            properties: { type: { enum: ['bug'] }, severity: { bsonType: 'int' } },
            required: ['severity', 'type'],
            closed: true,
          },
        ],
      },
    ]);
  });

  it('reads one root model per anyOf branch', () => {
    expect(validatorRootShapesOf({ bsonType: 'object', anyOf: [task, user] })).toEqual([
      expect.objectContaining({ required: ['_id', 'type'] }),
      { properties: user.properties, required: ['_id', 'email'], closed: true, variants: [] },
    ]);
  });
});

describe('validatorFieldNamesOf', () => {
  it('lists the fields of every root model and variant', () => {
    expect([...validatorFieldNamesOf({ bsonType: 'object', anyOf: [task, user] })].sort()).toEqual([
      '_id',
      'email',
      'severity',
      'type',
    ]);
  });

  it('lists nothing for a schema that is not an object', () => {
    expect([...validatorFieldNamesOf(undefined)]).toEqual([]);
  });
});

describe('validatorDocumentShapesOf', () => {
  it('reads each root model, or each of its variants with the root fields, keyed by root and discriminator value', () => {
    expect(validatorDocumentShapesOf({ bsonType: 'object', anyOf: [user, task] })).toEqual([
      {
        key: '0/2',
        root: '0/2',
        rootIndex: 0,
        discriminator: undefined,
        required: ['_id', 'email'],
        properties: user.properties,
        closed: true,
      },
      {
        key: '1/2:["type","bug"]',
        root: '1/2',
        rootIndex: 1,
        discriminator: { field: 'type', value: 'bug' },
        required: ['_id', 'type', 'severity'],
        properties: {
          _id: { bsonType: 'objectId' },
          type: { enum: ['bug'] },
          severity: { bsonType: 'int' },
        },
        closed: true,
      },
    ]);
  });

  it('keys a variant with no single-valued field by its position', () => {
    const unnamed = { ...task, oneOf: [{ required: [], properties: {} }] };
    expect(validatorDocumentShapesOf(unnamed).map(({ key }) => key)).toEqual(['0/1:0']);
  });
});

describe('validatorDocumentShapesOf, a base field with a one-value enum', () => {
  it('reads the discriminator as the property that is only an enum, not a field typed by a one-value enum', () => {
    const region = { bsonType: 'string', enum: ['EU'] };
    const withRegion = {
      bsonType: 'object',
      required: ['_id', 'type', 'region'],
      properties: { _id: { bsonType: 'objectId' }, type: { bsonType: 'string' }, region },
      oneOf: ['bug', 'feature'].map((value) => ({
        required: ['type'],
        properties: { region, type: { enum: [value] } },
        additionalProperties: false,
      })),
    };

    expect(
      validatorDocumentShapesOf(withRegion).map(({ key, discriminator }) => ({
        key,
        discriminator,
      })),
    ).toEqual([
      { key: '0/1:["type","bug"]', discriminator: { field: 'type', value: 'bug' } },
      { key: '0/1:["type","feature"]', discriminator: { field: 'type', value: 'feature' } },
    ]);
  });
});

describe('sameKindOfDocumentIn', () => {
  const plainTask = {
    bsonType: 'object',
    required: ['_id'],
    properties: { _id: { bsonType: 'objectId' } },
  };
  const taskByKind = {
    ...task,
    required: ['_id', 'kind', 'type'],
    properties: { ...task.properties, kind: { bsonType: 'string' } },
    oneOf: [
      {
        required: ['kind', 'severity'],
        properties: { kind: { enum: ['bug'] }, severity: { bsonType: 'int' } },
        additionalProperties: false,
      },
    ],
  };
  const [bugByKind] = validatorDocumentShapesOf(taskByKind);

  it('finds the shape with the same key', () => {
    const before = validatorDocumentShapesOf({ bsonType: 'object', anyOf: [user, task] });
    const after = validatorDocumentShapesOf({ bsonType: 'object', anyOf: [user, task] });

    expect(
      after.map((shape) => {
        const found = sameKindOfDocumentIn(before, shape);
        return [found?.shape.key, found?.matchedBy];
      }),
    ).toEqual([
      ['0/2', 'key'],
      ['1/2:["type","bug"]', 'key'],
    ]);
  });

  it('finds the root a variant comes from when that root had no variants', () => {
    const [bug] = validatorDocumentShapesOf(task);

    const found = sameKindOfDocumentIn(validatorDocumentShapesOf(plainTask), bug!);

    expect([found?.shape.key, found?.matchedBy]).toEqual(['0/1', 'root']);
  });

  it('finds the variant of the same root with the same discriminator value when the discriminator field changes', () => {
    const found = sameKindOfDocumentIn(validatorDocumentShapesOf(task), bugByKind!);

    expect([found?.shape.key, found?.matchedBy]).toEqual([
      '0/1:["type","bug"]',
      'discriminatorValue',
    ]);
  });

  it('matches no root of a validator with another number of roots, since a root added or removed moves the others', () => {
    const before = validatorDocumentShapesOf({ bsonType: 'object', anyOf: [user, plainTask] });
    const after = validatorDocumentShapesOf({ bsonType: 'object', anyOf: [plainTask, user, task] });

    expect(after.map((shape) => sameKindOfDocumentIn(before, shape))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('finds nothing for a variant whose value the root did not have', () => {
    const epic = {
      ...task,
      oneOf: [{ required: ['type'], properties: { type: { enum: ['epic'] } } }],
    };
    const [epicShape] = validatorDocumentShapesOf(epic);

    expect(sameKindOfDocumentIn(validatorDocumentShapesOf(task), epicShape!)).toBeUndefined();
  });
});

describe('propertyBsonTypesOf', () => {
  it('reads one type, a list of types, and number as every numeric type', () => {
    expect([
      propertyBsonTypesOf({ bsonType: 'string' }),
      propertyBsonTypesOf({ bsonType: ['null', 'int'] }),
      propertyBsonTypesOf({ bsonType: 'number' }),
      propertyBsonTypesOf({}),
      propertyBsonTypesOf(undefined),
    ]).toEqual([['string'], ['null', 'int'], ['int', 'long', 'double', 'decimal'], [], []]);
  });
});
