import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqlRawColumn, sqlRawDescriptor } from '../src/ast/sql-codecs';

const ctx: CodecInstanceContext = { name: 'sql-raw-codec' };

describe('sql/raw@1', () => {
  const codec = sqlRawDescriptor.factory({ sql: 'tsvector' })(ctx);

  it('declares no traits', () => {
    expect([sqlRawDescriptor.codecId, sqlRawDescriptor.traits]).toEqual(['sql/raw@1', []]);
  });

  it('encodes and decodes by identity', async () => {
    const value = { anything: ["'a':1"] };
    expect(await codec.encode(value, {})).toBe(value);
    expect(await codec.decode("'a':1 'b':2", {})).toBe("'a':1 'b':2");
  });

  it.each([
    ['text', "'a':1"],
    ['a number', 1],
    ['an object', { a: [1] }],
  ])('reads %s the database returns in JSON unchanged', (_name, json) => {
    expect(codec.decodeJson(json)).toBe(json);
  });

  it('writes a JSON value as itself, and refuses a value JSON cannot hold', () => {
    expect(codec.encodeJson({ a: ['b', 1] })).toEqual({ a: ['b', 1] });
    expect(() => codec.encodeJson(new Date(0))).toThrow(
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
