import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqliteRealDescriptor,
  sqliteSqlFloatDescriptor,
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

  // SQLite stores an infinity and writes it in JSON as 9.0e+999, which JSON.parse reads as Infinity; it cannot store NaN, which becomes NULL.
  it('reads finite numbers, the infinities SQLite writes, and the text encodeJson writes for them', () => {
    expect(
      [1.5, 0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'Infinity', '-Infinity'].map(
        (json) => codec.decodeJson(json),
      ),
    ).toEqual([
      1.5,
      0,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
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

  it.each([['NaN'], ['1.5'], [true], [null]])('refuses %j', (json) => {
    expect(() => codec.decodeJson(json)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: expect.objectContaining({ codecId: 'sqlite/real@1' }),
      }),
    );
  });
});

describe('sql/float@1 on SQLite decodeJson', () => {
  it('reads the infinities SQLite writes in JSON', () => {
    const codec = sqliteSqlFloatDescriptor.factory()(ctx);
    expect(
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5].map((json) =>
        codec.decodeJson(json),
      ),
    ).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5]);
  });
});
