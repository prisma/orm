import { field as mongoField } from '@internal/mongo/contract-builder';
import { field as postgresField } from '@internal/postgres/contract-builder';
import { field as sqliteField } from '@internal/sqlite/contract-builder';
import { cloneDeep, isEmpty, isPlainObject, merge } from 'lodash';
import { describe, expect, it } from 'vitest';

describe.each([
  ['Postgres', postgresField, 'id.uuidv4String'],
  ['SQLite', sqliteField, 'id.uuidv4String'],
  ['MongoDB', mongoField, 'temporal.createdAt'],
])('the %s field helpers', (_, field, preset) => {
  it(`refuse the removed preset field.${preset}`, () => {
    expect(() =>
      preset.split('.').reduce<unknown>((value, key) => Reflect.get(Object(value), key), field),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.FIELD_HELPER_UNKNOWN',
        message: expect.stringContaining(`field.${preset} was a field preset`),
      }),
    );
  });

  it('read a name that was never a preset as on a plain object', () => {
    expect([
      Reflect.get(field, 'length'),
      Reflect.get(field, 'name'),
      Reflect.get(field, 'default'),
      Reflect.get(field, 'colum'),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('pass through lodash and Array.from as a plain object does', () => {
    const keys = Object.keys(field);
    expect({
      isPlainObject: isPlainObject(field),
      isEmpty: isEmpty(field),
      cloneDeep: Object.keys(cloneDeep(field)),
      merge: Object.keys(merge({}, field)),
      arrayFrom: Array.from(Object(field)),
    }).toEqual({
      isPlainObject: true,
      isEmpty: false,
      cloneDeep: keys,
      merge: keys,
      arrayFrom: [],
    });
  });
});
