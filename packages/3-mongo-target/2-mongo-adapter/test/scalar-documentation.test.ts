import { describe, expect, it } from 'vitest';
import { mongoScalarAuthoringTypes } from '../src/exports/control';

describe('scalar documentation', () => {
  it.each(Object.entries(mongoScalarAuthoringTypes))('documents %s', (_name, descriptor) => {
    expect(descriptor).toHaveProperty('documentation', expect.stringMatching(/\S.+/));
  });

  it.each([
    ['String', 'string'],
    ['Int32', 'int'],
    ['Int64', 'long'],
    ['Double', 'double'],
    ['Decimal128', 'decimal'],
    ['Bool', 'bool'],
    ['Date', 'date'],
    ['ObjectId', 'objectId'],
    ['Binary', 'binData'],
  ] as const)('documents %s by the BSON type it is stored as', (name, bsonType) => {
    expect(mongoScalarAuthoringTypes[name].documentation).toContain(`stored as BSON ${bsonType}`);
  });

  it('documents that Json fields are not constrained by a BSON type', () => {
    expect(mongoScalarAuthoringTypes.Json.documentation).toMatch(/any JSON value/i);
  });
});
