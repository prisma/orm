import { describe, expect, it } from 'vitest';
import {
  documentIdBsonTypesOf,
  documentIdRefusalOf,
  documentIdRefusalReason,
} from '../src/document-id-refusal';
import { mongoTypeLookups } from '../src/fake-type-lookups';
import { arrayField, scalarField, voField } from './derive-json-schema-helpers';

describe('documentIdRefusalOf', () => {
  it.each([
    ['an objectId', 'mongo/objectId@1', ['objectId']],
    ['a string', 'mongo/string@1', ['string']],
    ['several allowed types', 'test/int-or-long@1', ['int', 'long']],
  ])('accepts an _id stored as %s', (_case, codecId, bsonTypes) => {
    expect(documentIdRefusalOf(codecId, bsonTypes)).toBeUndefined();
  });

  it.each([
    ['json', 'mongo/json@1', ['object', 'array', 'string', 'null'], ['array', 'null']],
    ['a vector', 'mongo/vector@1', ['array'], ['array']],
    ['a regular expression', 'test/regex@1', ['regex'], ['regex']],
    ['undefined', 'test/undefined@1', ['undefined', 'string'], ['undefined']],
  ])('refuses an _id whose codec can store %s', (_case, codecId, bsonTypes, forbidden) => {
    expect(documentIdRefusalOf(codecId, bsonTypes)).toEqual({
      forbidden,
      reason: documentIdRefusalReason(codecId, forbidden),
    });
  });

  it('refuses an _id whose codec can store any BSON type, which includes every type an _id cannot have', () => {
    expect(documentIdRefusalOf('mongo/bson@1', [])).toEqual({
      forbidden: ['array', 'regex', 'undefined', 'null'],
      reason:
        'can hold any BSON type (codec "mongo/bson@1"). An _id cannot be an array, a regular expression, undefined or null: MongoDB refuses the first three, and every document has an _id.',
    });
  });

  it('names the codec and the BSON types MongoDB refuses as an _id', () => {
    expect(documentIdRefusalReason('mongo/json@1', ['array', 'null'])).toBe(
      'can hold BSON type array or null (codec "mongo/json@1"). An _id cannot be an array, a regular expression, undefined or null: MongoDB refuses the first three, and every document has an _id.',
    );
  });
});

describe('documentIdBsonTypesOf', () => {
  it('reads the BSON types of the codec', () => {
    expect(documentIdBsonTypesOf(scalarField('mongo/json@1'), mongoTypeLookups)).toEqual([
      'object',
      'array',
      'string',
      'double',
      'int',
      'long',
      'bool',
      'null',
    ]);
  });

  it('stores a list as an array and adds null to a nullable field', () => {
    expect([
      documentIdBsonTypesOf(arrayField('mongo/objectId@1'), mongoTypeLookups),
      documentIdBsonTypesOf(scalarField('mongo/string@1', true), mongoTypeLookups),
    ]).toEqual([['array'], ['string', 'null']]);
  });

  it('gives no BSON types for a value object or a codec no pack provides', () => {
    expect([
      documentIdBsonTypesOf(voField('Key'), mongoTypeLookups),
      documentIdBsonTypesOf(scalarField('unknown/codec@1'), mongoTypeLookups),
    ]).toEqual([undefined, undefined]);
  });
});
