import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqliteRealDescriptor,
  sqliteSqlCharDescriptor,
  sqliteSqlVarcharDescriptor,
  sqliteTextDescriptor,
} from '../src/core/codecs';
import { fromContractJson, toContractJson } from './contract-json';

const ctx: CodecInstanceContext = { name: 'decode-json-forms' };

describe('sqlite/text@1 contract values', () => {
  const codec = sqliteTextDescriptor.factory()(ctx);

  // SQLite's json_object and json_group_array write a TEXT column as a JSON string, including a number stored into it, which TEXT affinity converts to text.
  it('reads the JSON strings SQLite writes for a text column', () => {
    expect(['hello', '', '42'].map((json) => fromContractJson(codec, json))).toEqual([
      'hello',
      '',
      '42',
    ]);
  });

  it.each([
    [42, '42'],
    [true, 'true'],
    [null, 'null'],
    [['a'], '["a"]'],
  ])('refuses %j', (json, received) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        message: 'sqlite/text JSON value must be a string',
        meta: { dataType: 'sqlite/text', received },
      }),
    );
  });
});

describe('sqlite/real@1 contract values', () => {
  const codec = sqliteRealDescriptor.factory()(ctx);

  // SQLite writes an infinity in JSON as 9.0e+999, so the float projections write the text the codec stores instead; SQLite cannot store NaN, which becomes NULL.
  it('reads finite numbers and the text the projection and the codec write for the infinities', () => {
    expect([1.5, 0, 'Infinity', '-Infinity'].map((json) => fromContractJson(codec, json))).toEqual([
      1.5,
      0,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
  });

  it('writes the infinities as text and refuses NaN, which SQLite cannot store', () => {
    expect(
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((value) =>
        toContractJson(codec, value),
      ),
    ).toEqual(['Infinity', '-Infinity']);
    expect(() => codec.toDataTypeValue(Number.NaN)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        meta: expect.objectContaining({ codecId: 'sqlite/real@1' }),
      }),
    );
  });

  it('refuses the text NaN, which the type reads and SQLite cannot store', () => {
    expect(() => fromContractJson(codec, 'NaN')).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: expect.objectContaining({ codecId: 'sqlite/real@1' }),
      }),
    );
  });

  it.each([[Number.POSITIVE_INFINITY], ['1.5'], [true], [null]])('refuses %j', (json) => {
    expect(() => fromContractJson(codec, json)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: expect.objectContaining({ dataType: 'sqlite/real' }),
      }),
    );
  });
});

describe('sql/char@1 and sql/varchar@1 on SQLite contract values', () => {
  // SQLite does not enforce a declared length, so a column can hold longer text, and the codec reads what it holds.
  it('reads text longer than the declared length', () => {
    const varchar = sqliteSqlVarcharDescriptor.factory({ length: 3 })(ctx);
    const char = sqliteSqlCharDescriptor.factory({ length: 3 })(ctx);
    expect([
      fromContractJson(varchar, 'toolong', { length: 3 }),
      fromContractJson(char, 'toolong', { length: 3 }),
    ]).toEqual(['toolong', 'toolong']);
  });
});
