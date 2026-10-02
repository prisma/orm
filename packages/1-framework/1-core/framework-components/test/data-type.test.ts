import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  createDataTypeLookup,
  dataType,
  dataTypeId,
  objectSchemaKeys,
  requiredParamKeys,
  requiredSchemaKeys,
} from '../src/shared/data-type';

describe('dataTypeId', () => {
  it.each(['pg/int8', 'sqlite/integer', 'postgis/geometry', 'pg/text-array', 'arktype/json'])(
    'reads %s as a data type id',
    (id) => {
      expect(dataTypeId(id)).toBe(id);
    },
  );

  it.each([
    ['a version, which names a codec rather than a type', 'pg/int8@1'],
    ['no owner', 'int8'],
    ['an empty name', 'pg/'],
    ['an empty owner', '/int8'],
    ['a second slash', 'pg/int8/x'],
    ['an upper-case letter', 'Pg/Int8'],
    ['nothing at all', ''],
    ['a space', 'pg/int 8'],
  ])('refuses %s', (_why, id) => {
    expect(() => dataTypeId(id)).toThrow(/is not a data type id/i);
  });
});

describe('dataType', () => {
  it('declares a type that casts from nothing', () => {
    const type = dataType('pg/int2', {});
    expect(type).toEqual({ id: 'pg/int2', casts: {} });
  });

  it('validates its id', () => {
    expect(() => dataType('pg/int2@1', {})).toThrow();
  });

  it('keeps each cast under the id of the type it casts from', () => {
    const int2 = dataType('pg/int2', {});
    const int8 = dataType('pg/int8', { casts: { [int2.id]: (value) => String(value) } });
    expect(int8.casts[int2.id]?.(42)).toBe('42');
  });

  it('keeps the function that gives a value its canonical form', () => {
    const date = dataType('pg/date', {
      toCanonicalForm: (value) => (value === '2024-1-1' ? '2024-01-01' : value),
    });
    expect(date.toCanonicalForm?.('2024-1-1')).toBe('2024-01-01');
  });

  it('declares no canonical-form function when none is given', () => {
    expect(dataType('pg/int2', {}).toCanonicalForm).toBeUndefined();
  });

  it('validates the id of every type it casts from', () => {
    expect(() => dataType('pg/int8', { casts: { 'pg/int2@1': (value) => value } })).toThrow();
  });

  it('keeps a list cast and the types its elements may be', () => {
    const int2 = dataType('pg/int2', {});
    const vector = dataType('pgvector/vector', {
      listCast: { of: [int2.id], cast: (elements) => [...elements] },
    });
    expect(vector.listCast?.of).toEqual(['pg/int2']);
    expect(vector.listCast?.cast([1, 2])).toEqual([1, 2]);
  });

  it('validates the id of every type a list cast takes elements of', () => {
    expect(() =>
      dataType('pgvector/vector', {
        listCast: { of: [dataTypeId('pg/int2'), 'nonsense'], cast: (elements) => [...elements] },
      }),
    ).toThrow();
  });

  it('carries the parameter schema it is declared with', () => {
    const params = type({ 'length?': 'number.integer > 0' });
    expect(dataType('pg/varchar', { params }).params).toBe(params);
  });

  it('has no parameter schema unless one is declared', () => {
    expect(dataType('pg/text', {})).not.toHaveProperty('params');
  });
});

describe('createDataTypeLookup', () => {
  const int2 = dataType('pg/int2', {});
  const int8 = dataType('pg/int8', { casts: { [int2.id]: (value) => String(value) } });
  const lookup = createDataTypeLookup([int2, int8]);

  it('finds a type by id', () => {
    expect(lookup.get(int8.id)).toBe(int8);
  });

  it('has no type it was not given', () => {
    expect(lookup.get(dataTypeId('pg/int4'))).toBeUndefined();
    expect(lookup.has(dataTypeId('pg/int4'))).toBe(false);
  });

  it('says which ids it holds', () => {
    expect(lookup.has(int2.id)).toBe(true);
  });

  it('lists every type in the order it was given', () => {
    expect(lookup.all()).toEqual([int2, int8]);
    expect(createDataTypeLookup([int8, int2]).all()).toEqual([int8, int2]);
  });
});

describe('requiredParamKeys', () => {
  it('lists the parameters a data type requires', () => {
    const vector = dataType('t/vector', { params: type({ length: 'number', 'scale?': 'number' }) });
    expect(requiredParamKeys(vector)).toEqual(['length']);
  });

  it('is empty for a data type whose parameters are optional', () => {
    expect(
      requiredParamKeys(dataType('t/char', { params: type({ 'length?': 'number' }) })),
    ).toEqual([]);
  });

  it('is empty for a data type without parameters', () => {
    expect(requiredParamKeys(dataType('t/text', {}))).toEqual([]);
  });
});

describe('arktype object schema keys', () => {
  const shapes = [
    ['a plain object', type({ length: 'number', 'scale?': 'number' })],
    [
      'an object with a narrow',
      type({ length: 'number', 'scale?': 'number' }).narrow((params) => params.length > 0),
    ],
    ['the intersection of two objects', type({ length: 'number' }).and({ 'scale?': 'number' })],
  ] as const;

  it.each(shapes)('reads every key of %s', (_, schema) => {
    expect(objectSchemaKeys(schema)).toEqual(['length', 'scale']);
  });

  it.each(shapes)('reads the required keys of %s', (_, schema) => {
    expect(requiredSchemaKeys(schema)).toEqual(['length']);
  });

  it('reads no keys from a schema that does not describe objects', () => {
    expect(objectSchemaKeys(type('string'))).toBeUndefined();
    expect(requiredSchemaKeys(type('number.integer >= 1'))).toBeUndefined();
  });

  it.each([
    ['a union of objects', type({ length: 'number' }).or({ scale: 'number' })],
    ['a piped object', type({ length: 'number' }).pipe((params) => params)],
  ] as const)('reads no keys from %s', (_, schema) => {
    expect(objectSchemaKeys(schema)).toBeUndefined();
    expect(requiredSchemaKeys(schema)).toBeUndefined();
  });

  it('reads no keys from a value that is not a schema', () => {
    expect(objectSchemaKeys({ props: [] })).toBeUndefined();
    expect(requiredSchemaKeys(undefined)).toBeUndefined();
  });
});
