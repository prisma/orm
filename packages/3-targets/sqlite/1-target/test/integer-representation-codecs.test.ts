import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { AggregateExpr, CastExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { hexJsonProjectionOr } from '../src/core/blob-json-projection';
import { SQLITE_BIGINT_NUMBER_CODEC_ID } from '../src/core/codec-ids';
import {
  sqliteBigintDescriptor,
  sqliteBigintNumberDescriptor,
  sqliteIntegerDescriptor,
} from '../src/core/codecs';
import { fromContractJson, toContractJson } from './contract-json';

const instanceCtx: CodecInstanceContext = { name: 'test' };

/**
 * A value the typed surface refuses, as a JS caller — or a migration from the
 * previous result type — still supplies it. The encode guards answer for what
 * reaches them at runtime, so that is what these cases hand them.
 */
const wrongTyped = (value: unknown): never => value as never;

describe('sqlite/bigint@1 number wire values', () => {
  const codec = sqliteBigintDescriptor.factory()(instanceCtx);

  it('reads the exact integer the driver returns at both 64-bit extremes', async () => {
    expect(await codec.fromWire(9223372036854775807n, {})).toBe(9223372036854775807n);
    expect(await codec.fromWire(-9223372036854775808n, {})).toBe(-9223372036854775808n);
  });

  it.each([
    [new Uint8Array([0x35]), "x'35'"],
    [['35'], "x'35'"],
  ])('refuses the blob %j a row or an include carries', async (wire, received) => {
    await expect(codec.fromWire(wire as never, {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `A sqlite/bigint@1 value is bytes ${received}, which is not an integer. sqlite/bigint@1 reads integers from -9223372036854775808 to 9223372036854775807.`,
      meta: { codecId: 'sqlite/bigint@1', received },
    });
  });

  it('reads a safe-integer number wire value exactly', async () => {
    expect(await codec.fromWire(42, {})).toBe(42n);
    expect(await codec.fromWire(9007199254740991, {})).toBe(9007199254740991n);
    expect(await codec.fromWire(-9007199254740991, {})).toBe(-9007199254740991n);
  });

  it('rejects a number wire value past the safe range, which has already lost precision', async () => {
    await expect(codec.fromWire(9007199254740992, {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'sqlite/bigint@1 wire number must be an integer within the safe integer range, got 9007199254740992',
      meta: { codecId: 'sqlite/bigint@1', received: '9007199254740992' },
    });
    await expect(codec.fromWire(-9007199254740992, {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      meta: { codecId: 'sqlite/bigint@1', received: '-9007199254740992' },
    });
  });

  it('rejects a non-integral number wire value with a structured error', async () => {
    await expect(codec.fromWire(1.5, {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'sqlite/bigint@1 wire number must be an integer within the safe integer range, got 1.5',
      meta: { codecId: 'sqlite/bigint@1', received: '1.5' },
    });
  });

  // The same guard from the other side of the pair: this codec reads a
  // `bigint`, so a `number` is named for the type it is — SQLite would store
  // a fractional one as the REAL it is, in a column of integers.
  it('names the expected type when a number arrives where a bigint is read', async () => {
    await expect(codec.toWire(wrongTyped(9), {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'sqlite/bigint@1 value must be a bigint, got number 9',
      meta: { codecId: 'sqlite/bigint@1', received: 'number' },
    });
  });

  // A schema literal (`BigInt @default(0)`) reaches the JSON boundary as a
  // number, because that is the only integer a schema language writes.
  it('reads a schema-written integer literal at the JSON boundary', () => {
    expect(toContractJson(codec, wrongTyped(0))).toBe('0');
    expect(toContractJson(codec, wrongTyped(-42))).toBe('-42');
  });

  it('rejects a written number the literal does not name exactly', () => {
    expect(() => codec.toDataTypeValue(wrongTyped(1.5))).toThrow(
      'sqlite/bigint@1 number literal must be an integer within the safe integer range, got 1.5',
    );
    expect(() => codec.toDataTypeValue(wrongTyped(9007199254740992))).toThrow(
      'sqlite/bigint@1 number literal must be an integer within the safe integer range, got 9007199254740992',
    );
  });
});

describe('sqlite/bigintnumber@1', () => {
  const codec = sqliteBigintNumberDescriptor.factory()(instanceCtx);

  describe('decode', () => {
    it('reads number, decimal-text, and bigint wire forms within the safe range', async () => {
      expect(await codec.fromWire(42, {})).toBe(42);
      expect(await codec.fromWire('9007199254740991', {})).toBe(9007199254740991);
      expect(await codec.fromWire(-9007199254740991n, {})).toBe(-9007199254740991);
    });

    it('throws at 2^53 on every wire form', async () => {
      await expect(codec.fromWire(9007199254740992, {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
      await expect(codec.fromWire('9007199254740992', {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
      await expect(codec.fromWire(9007199254740992n, {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
    });

    it('throws at -(2^53)', async () => {
      await expect(codec.fromWire(-9007199254740992n, {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
      await expect(codec.fromWire('-9007199254740992', {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
    });

    it('throws on decimal text a Number() coercion would silently round', async () => {
      await expect(codec.fromWire('9007199254740993', {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
    });

    it('throws on non-integral wire values', async () => {
      await expect(codec.fromWire(1.5, {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
      await expect(codec.fromWire('1.5', {})).rejects.toThrow(
        'sqlite/bigintnumber@1 wire value must be a decimal string',
      );
    });

    it('raises a structured error carrying the codec id and the received value', async () => {
      await expect(codec.fromWire(9007199254740992n, {})).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        meta: { codecId: 'sqlite/bigintnumber@1', received: '9007199254740992' },
      });
    });
  });

  describe('encode', () => {
    it('writes the integer wire value within the safe range', async () => {
      expect(await codec.toWire(9007199254740991, {})).toBe(9007199254740991);
      expect(await codec.toWire(-9007199254740991, {})).toBe(-9007199254740991);
    });

    it('negative zero encodes as plain zero', async () => {
      const wire = await codec.toWire(-0, {});
      expect(wire).toBe(0);
      expect(await codec.fromWire(wire, {})).toBe(0);
    });

    it('rejects out-of-range writes at 2^53 and -(2^53)', async () => {
      await expect(codec.toWire(9007199254740992, {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
      await expect(codec.toWire(-9007199254740992, {})).rejects.toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
    });

    it('rejects non-integral writes with a structured error', async () => {
      await expect(codec.toWire(1.5, {})).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
        message:
          'sqlite/bigintnumber@1 value must be an integer within the safe integer range, got 1.5',
        meta: { codecId: 'sqlite/bigintnumber@1', received: '1.5' },
      });
    });

    // A value of the wrong type is not a value out of range, and saying so
    // about a plainly in-range 9 sends the reader looking for a magnitude
    // problem. The type is what changed, so the type is what the message names.
    it('names the expected type when a bigint arrives where a number is read', async () => {
      await expect(codec.toWire(wrongTyped(9n), {})).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
        message: 'sqlite/bigintnumber@1 value must be a number, got bigint 9',
        meta: { codecId: 'sqlite/bigintnumber@1', received: 'bigint' },
      });
      expect(() => codec.toDataTypeValue(wrongTyped(9n))).toThrow(
        'sqlite/bigintnumber@1 value must be a number, got bigint 9',
      );
    });
  });

  describe('contract values', () => {
    it('uses decimal text as the canonical form at both safe-range boundaries', () => {
      expect(toContractJson(codec, 9007199254740991)).toBe('9007199254740991');
      expect(fromContractJson(codec, '9007199254740991')).toBe(9007199254740991);
      expect(toContractJson(codec, -9007199254740991)).toBe('-9007199254740991');
      expect(fromContractJson(codec, '-9007199254740991')).toBe(-9007199254740991);
    });

    it('rejects out-of-range and non-integral values on the encode side', () => {
      expect(() => codec.toDataTypeValue(9007199254740992)).toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
      expect(() => codec.toDataTypeValue(1.5)).toThrow(
        'sqlite/bigintnumber@1 value must be an integer within the safe integer range',
      );
    });
  });

  it('projects a text-cast aggregate as text, and a blob as the array of its hex text', () => {
    const lowered = CastExpr.as(new AggregateExpr('count', undefined), 'text');
    expect(
      sqliteBigintNumberDescriptor.projectJson(lowered, {
        codecId: SQLITE_BIGINT_NUMBER_CODEC_ID,
      }),
    ).toEqual(hexJsonProjectionOr(lowered, CastExpr.as(lowered, 'TEXT')));
  });

  it.each([
    [new Uint8Array([0x35]), "x'35'"],
    [['35'], "x'35'"],
  ])('refuses the blob %j a row or an include carries', async (wire, received) => {
    await expect(codec.fromWire(wire as never, {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `A sqlite/bigintnumber@1 value is bytes ${received}, which is not an integer within the safe integer range. sqlite/bigintnumber@1 reads integers from -9007199254740991 to 9007199254740991.`,
      meta: { codecId: 'sqlite/bigintnumber@1', received },
    });
  });

  it('carries the numeric ordering traits', () => {
    expect(sqliteBigintNumberDescriptor.traits).toEqual(['equality', 'order', 'numeric']);
  });

  it('renders a default as a number literal', () => {
    expect(sqliteBigintNumberDescriptor.renderValueLiteral?.('42')).toBe('42');
  });
});

describe('sqlite/integer@1 guards the safe integer range as sqlite/bigintnumber@1 does', () => {
  const codec = sqliteIntegerDescriptor.factory()(instanceCtx);

  it('writes and reads an integer within the safe range, and negative zero as zero', async () => {
    expect({
      written: await codec.toWire(9007199254740991, {}),
      read: await codec.fromWire(-9007199254740991, {}),
      negativeZero: await codec.toWire(-0, {}),
    }).toEqual({ written: 9007199254740991, read: -9007199254740991, negativeZero: 0 });
  });

  it.each([9007199254740992, -9007199254740992, 1.5])('refuses to write %d', async (value) => {
    await expect(codec.toWire(value, {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `sqlite/integer@1 value must be an integer within the safe integer range, got ${value}`,
      meta: { codecId: 'sqlite/integer@1', received: String(value) },
    });
  });

  it('refuses to write a value that is not a number', async () => {
    await expect(codec.toWire(wrongTyped(9n), {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: 'sqlite/integer@1 value must be a number, got bigint 9',
    });
  });

  it.each([9007199254740992, 1.5])('refuses to read the number %d', async (wire) => {
    await expect(codec.fromWire(wire, {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `A sqlite/integer@1 value is ${wire}, which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
    });
  });

  it.each([
    [1.5, '1.5'],
    ['9007199254740992', '"9007199254740992"'],
    ['abc', '"abc"'],
  ])('names the column of a stored %j it cannot read', async (wire, shown) => {
    await expect(
      codec.fromWire(wire, { column: { table: 'meter', name: 'peak' } }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `Column "meter"."peak" holds ${shown}, which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
      meta: { codecId: 'sqlite/integer@1', table: 'meter', column: 'peak', received: String(wire) },
    });
  });

  it.each([
    ['one byte a row carries', new Uint8Array([0x35]), '35'],
    ['bytes a row carries', new Uint8Array([0x00, 0xff]), '00FF'],
    ['the hex text of bytes an include carries', ['35'], '35'],
  ])('refuses %s, naming them as bytes', async (_name, wire, hex) => {
    await expect(
      codec.fromWire(wrongTyped(wire), { column: { table: 'meter', name: 'peak' } }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message: `Column "meter"."peak" holds bytes x'${hex}', which is not an integer within the safe integer range. sqlite/integer@1 reads integers from -9007199254740991 to 9007199254740991.`,
      meta: { codecId: 'sqlite/integer@1', table: 'meter', column: 'peak', received: `x'${hex}'` },
    });
  });
});
