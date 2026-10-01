import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqliteRealDescriptor,
  sqliteSqlCharDescriptor,
  sqliteSqlVarcharDescriptor,
  sqliteTextDescriptor,
} from '../src/core/codecs';

const ctx: CodecInstanceContext = { name: 'decode-json-forms' };

describe('sqlite/text@1 decodeJson', () => {
  const codec = sqliteTextDescriptor.factory()(ctx);

  // SQLite's json_object and json_group_array write a TEXT column as a JSON string, including a number stored into it, which TEXT affinity converts to text.
  it('reads the JSON strings SQLite writes for a text column', () => {
    expect(['hello', '', '42'].map((json) => codec.decodeJson(json))).toEqual(['hello', '', '42']);
  });

  it.each([
    [42, '42'],
    [true, 'true'],
    [null, 'null'],
    [['a'], '["a"]'],
  ])('refuses %j', (json, received) => {
    expect(() => codec.decodeJson(json)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: { codecId: 'sqlite/text@1', received },
      }),
    );
  });
});

describe('sqlite/real@1 decodeJson and encodeJson', () => {
  const codec = sqliteRealDescriptor.factory()(ctx);

  // SQLite writes an infinity in JSON as 9.0e+999, so the float projections write the text encodeJson writes instead; SQLite cannot store NaN, which becomes NULL.
  it('reads finite numbers and the text the projection and encodeJson write for the infinities', () => {
    expect([1.5, 0, 'Infinity', '-Infinity'].map((json) => codec.decodeJson(json))).toEqual([
      1.5,
      0,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  });

  it('writes the infinities as text and refuses NaN, which SQLite cannot store', () => {
    expect(
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((value) => codec.encodeJson(value)),
    ).toEqual(['Infinity', '-Infinity']);
    expect(() => codec.encodeJson(Number.NaN)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        meta: expect.objectContaining({ codecId: 'sqlite/real@1' }),
      }),
    );
  });

  it.each([['NaN'], [Number.POSITIVE_INFINITY], ['1.5'], [true], [null]])('refuses %j', (json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: expect.objectContaining({ codecId: 'sqlite/real@1' }),
      }),
    );
  });
});

describe('sql/char@1 and sql/varchar@1 on SQLite decodeJson', () => {
  // SQLite does not enforce a declared length, so a column can hold longer text, and the codec reads what it holds.
  it('reads text longer than the declared length', () => {
    const varchar = sqliteSqlVarcharDescriptor.factory({ length: 3 })(ctx);
    const char = sqliteSqlCharDescriptor.factory({ length: 3 })(ctx);
    expect([varchar.decodeJson('toolong'), char.decodeJson('toolong')]).toEqual([
      'toolong',
      'toolong',
    ]);
  });
});
