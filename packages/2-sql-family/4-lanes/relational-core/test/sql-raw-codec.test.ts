import { sqlRawDataType } from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import { SqlRawCodec, sqlRawColumn, sqlRawDescriptor } from '../src/ast/sql-codecs';

describe('sql/raw@1', () => {
  const codec = new SqlRawCodec(sqlRawDescriptor, sqlRawDataType, { sql: 'tsvector' });

  it('declares no traits', () => {
    expect([sqlRawDescriptor.codecId, sqlRawDescriptor.traits]).toEqual(['sql/raw@1', []]);
  });

  it('writes and reads the wire value by identity', async () => {
    const value = { anything: ["'a':1"] };
    expect(await codec.toWire(value, {})).toBe(value);
    expect(await codec.fromWire("'a':1 'b':2", {})).toBe("'a':1 'b':2");
  });

  it.each([
    ['text', "'a':1"],
    ['a number', 1],
    ['an object', { a: [1] }],
  ])('refuses %s as a value of its data type, which has no literal values', (_name, value) => {
    expect(() => codec.toDataTypeValue(value)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.LITERAL_VALUES_ABSENT' }),
    );
  });

  it('refuses a value JSON cannot hold', () => {
    expect(() => codec.toDataTypeValue(new Date(0))).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        meta: expect.objectContaining({ codecId: 'sql/raw@1' }),
      }),
    );
  });

  it('builds a column of the raw type with the text as its parameter', () => {
    expect(sqlRawColumn('circle')).toMatchObject({
      codecId: 'sql/raw@1',
      typeParams: { sql: 'circle' },
    });
  });
});
