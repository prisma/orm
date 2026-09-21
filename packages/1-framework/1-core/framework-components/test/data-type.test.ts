import { describe, expect, it } from 'vitest';
import { createDataTypeLookup, dataType, dataTypeId } from '../src/shared/data-type';

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
});
