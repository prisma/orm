import { createDataTypeLookup } from '@internal/framework-components/codec';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { sameSqlColumnType, sqlDataType } from '../src/sql-data-type';

const text = sqlDataType('t/text', {
  read: (json) => json,
  texts: [{ text: 'text', written: true, catalog: true }],
});
const datetime = sqlDataType('t/datetime', { read: (json) => json, storedAs: text.id });
const numeric = sqlDataType('t/numeric', {
  params: arktype({ 'precision?': 'number', 'scale?': 'number' }),
  read: (json) => json,
  texts: [
    { text: 'numeric', written: true, catalog: true },
    { text: 'numeric({precision})', written: true },
    { text: 'numeric({precision},{scale})', written: true, catalog: true },
  ],
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
});
const lookup = createDataTypeLookup([text, datetime, numeric]);

describe('sameSqlColumnType', () => {
  it('compares parameters in normal form, in any key order, without keys a codec keeps', () => {
    expect([
      sameSqlColumnType(
        { dataType: numeric.id, typeParams: { precision: 10 } },
        { dataType: numeric.id, typeParams: { scale: 0, precision: 10 } },
        lookup,
      ),
      sameSqlColumnType(
        { dataType: numeric.id, typeParams: { precision: 10, expression: 'x' } },
        { dataType: numeric.id, typeParams: { precision: 10, scale: 0 } },
        lookup,
      ),
      sameSqlColumnType(
        { dataType: numeric.id, typeParams: { precision: 10 } },
        { dataType: numeric.id, typeParams: { precision: 10, scale: 2 } },
        lookup,
      ),
    ]).toEqual([true, true, false]);
  });

  it('compares the types the data types are stored as', () => {
    expect(sameSqlColumnType({ dataType: datetime.id }, { dataType: text.id }, lookup)).toBe(true);
  });

  it('is false when only one is a list', () => {
    expect([
      sameSqlColumnType(
        { dataType: text.id, many: { elementNullable: false } },
        { dataType: text.id },
        lookup,
      ),
      sameSqlColumnType(
        { dataType: text.id, many: { elementNullable: false } },
        { dataType: text.id, many: { elementNullable: true } },
        lookup,
      ),
    ]).toEqual([false, true]);
  });
});
