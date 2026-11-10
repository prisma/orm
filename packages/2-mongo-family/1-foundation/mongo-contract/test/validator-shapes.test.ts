import { describe, expect, it } from 'vitest';
import { validatorFieldNamesOf, validatorRootShapesOf } from '../src/validator-shapes';

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
        variants: [
          {
            properties: { type: { enum: ['bug'] }, severity: { bsonType: 'int' } },
            required: ['severity', 'type'],
          },
        ],
      },
    ]);
  });

  it('reads one root model per anyOf branch', () => {
    expect(validatorRootShapesOf({ bsonType: 'object', anyOf: [task, user] })).toEqual([
      expect.objectContaining({ required: ['_id', 'type'] }),
      { properties: user.properties, required: ['_id', 'email'], variants: [] },
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
