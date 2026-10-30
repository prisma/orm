import type { JsonValue } from '@internal/contract/types';
import { createDataTypeLookup, dataType } from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  type FillValueTypes,
  fillValueProblem,
  scalarTypeNamesOf,
} from '../src/core/migrations/fill-value-check';
import { TEXT_CODEC_ID, testCodecLookup } from './enum-entity-fixtures';
import { contractWith, textType } from './value-object-contract-fixtures';

const stringDataType = dataType('test/string', {
  read: (json) => {
    if (typeof json === 'string') return json;
    throw structuredError('RUNTIME.DECODE_FAILED', 'test/string JSON value must be a string');
  },
});
const textDescriptor = testCodecLookup.descriptorFor(TEXT_CODEC_ID);
const types: FillValueTypes = {
  codecLookup: {
    ...testCodecLookup,
    descriptorFor: (id: string) =>
      id === textType.codecId && textDescriptor !== undefined
        ? { ...textDescriptor, codecId: id, dataType: stringDataType.id, jsonType: 'string' }
        : undefined,
  },
  dataTypeLookup: createDataTypeLookup([stringDataType]),
  scalarTypeName: ({ codecId }) => (codecId === textType.codecId ? 'String' : undefined),
};

const status = {
  plane: 'storage',
  namespaceId: 'app',
  entityKind: 'valueSet',
  entityName: 'Status',
} as const;

const contract = contractWith({
  valueSets: { Status: ['active', 'archived'] },
  valueObjects: {
    GeoPoint: {
      lat: 'scalar',
      note: { field: { nullable: true, type: textType } },
    },
    Address: {
      country: 'scalar',
      status: { field: { nullable: false, type: textType, valueSet: status } },
      tags: { field: { nullable: false, type: textType, many: { elementNullable: false } } },
      point: { valueObject: 'GeoPoint' },
      unknown: { field: { nullable: false, type: { kind: 'scalar', codecId: 'test/gone@1' } } },
    },
  },
  columns: [{ model: 'User', table: 'user', field: 'address', valueObject: 'Address' }],
});

function problem(field: string, value: JsonValue): string | undefined {
  return fillValueProblem(value, { text: field, check: { contract, types } });
}

describe('fillValueProblem', () => {
  it('names the field and its type for a scalar its data type refuses', () => {
    expect(problem('Address.country', 12)).toBe(
      'value 12 for field "Address.country" is not a String',
    );
    expect(problem('Address.country', 'NO')).toBeUndefined();
  });

  it('refuses an enum value outside the value set', () => {
    expect(problem('Address.status', 'BOGUS')).toBe(
      'value "BOGUS" for field "Address.status" is not a value of Status; it takes "active", "archived"',
    );
    expect(problem('Address.status', 'archived')).toBeUndefined();
  });

  it('refuses a list that is not a list, or that holds an element of another type', () => {
    expect(problem('Address.tags', 'x')).toBe(
      'value "x" for field "Address.tags" is not a list of String',
    );
    expect(problem('Address.tags', ['a', 3])).toBe(
      'value 3 for field "Address.tags" is not a String',
    );
    expect(problem('Address.tags', [])).toBeUndefined();
  });

  it('checks a value object field by field', () => {
    expect(problem('Address.point', 3)).toBe('value 3 for field "Address.point" is not a GeoPoint');
    expect(problem('Address.point', { lat: 1 })).toBe(
      'value 1 for field "GeoPoint.lat" is not a String',
    );
    expect(problem('Address.point', {})).toBe(
      'value {} for field "Address.point" lacks field "GeoPoint.lat", which is required',
    );
    expect(problem('Address.point', { lat: 'a', x: 1 })).toBe(
      'value {"lat":"a","x":1} for field "Address.point" has key "x", and GeoPoint has no field "x"',
    );
    expect(problem('Address.point', { lat: 'a', note: null })).toBeUndefined();
  });

  it('refuses null for a required field', () => {
    expect(problem('Address.country', null)).toBe(
      'value null for field "Address.country" is not a String',
    );
  });

  it('reports a codec the stack does not have as its own problem', () => {
    expect(problem('Address.unknown', 'x')).toBe(
      'field "Address.unknown" has codec "test/gone@1", which the stack does not have, so no value can be checked against it',
    );
  });

  it('refuses a field the end contract does not have, and checks nothing without a check', () => {
    expect(problem('Address.nope', 'x')).toBe(
      'field "Address.nope" is not a value object field of the end contract',
    );
    expect(fillValueProblem(12, { text: 'Address.country', check: undefined })).toBeUndefined();
  });
});

describe('scalarTypeNamesOf', () => {
  it('names a codec by the first scalar type constructor that makes it', () => {
    const nameOf = scalarTypeNamesOf({
      String: { kind: 'typeConstructor', output: { codecId: 'test/text@1' } },
      Decimal: { kind: 'typeConstructor', output: { codecId: 'test/text@1' } },
    });
    expect([nameOf({ codecId: 'test/text@1' }), nameOf({ codecId: 'test/int@1' })]).toEqual([
      'String',
      undefined,
    ]);
  });
});
