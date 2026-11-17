import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  sqliteDecimal,
  sqliteDecimalText,
  sqliteInteger,
  sqliteText,
} from '../src/core/data-types';
import {
  sqliteDecimalStringColumn,
  sqliteDecimalStringDescriptor,
} from '../src/core/decimal-codec';
import { fromContractJson, toContractJson } from './contract-json';

const instanceCtx: CodecInstanceContext = { name: 'test' };
const codec = sqliteDecimalStringDescriptor.factory()(instanceCtx);

const notString = (value: unknown): never => value as never;

describe('sqlite/decimal', () => {
  it.each([
    ['12.50', '12.50'],
    ['007', '7'],
    ['-00.10', '-0.10'],
    ['-0', '0'],
    ['-0.000', '0.000'],
    ['12345678901234567890.123456789', '12345678901234567890.123456789'],
  ])('stores %j as %j', (text, stored) => {
    expect(sqliteDecimalText(text)).toBe(stored);
  });

  it.each(['', 'abc', '1e5', '.5', '1.', '+1', ' 1', 'NaN', 'Infinity'])(
    'refuses %j, which is not decimal text',
    (text) => {
      expect(() => sqliteDecimalText(text)).toThrow(
        expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
      );
    },
  );

  it('is stored as text, and reads only its stored form from a contract', () => {
    expect(sqliteDecimal.sql.storedAs).toBe(sqliteText.id);
    expect(sqliteDecimal.toContract(sqliteDecimal.fromContract('12.50', {}))).toBe('12.50');
    expect(() => sqliteDecimal.fromContract('007', {})).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
    expect(() => sqliteDecimal.fromContract(12.5, {})).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED' }),
    );
  });

  it('takes a value of text and of an integer, which a default is written as', () => {
    expect({
      text: sqliteDecimal.casts[sqliteText.id]?.('012.50'),
      integer: sqliteDecimal.casts[sqliteInteger.id]?.('-42'),
    }).toEqual({ text: '12.50', integer: '-42' });
    expect(() => sqliteDecimal.casts[sqliteText.id]?.('twelve')).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});

describe('sqlite/decimal@1', () => {
  it('compares by equality only: text sorts by its characters, so it offers no order and no arithmetic', () => {
    expect({
      dataType: sqliteDecimalStringDescriptor.dataType,
      traits: sqliteDecimalStringDescriptor.traits,
      jsonType: sqliteDecimalStringDescriptor.jsonType,
    }).toEqual({ dataType: 'sqlite/decimal', traits: ['equality'], jsonType: 'string' });
  });

  it('writes decimal text in the form it stores', async () => {
    expect({
      plain: await codec.toWire('12.50', {}),
      leadingZeros: await codec.toWire('007.5', {}),
      negativeZero: await codec.toWire('-0.0', {}),
    }).toEqual({ plain: '12.50', leadingZeros: '7.5', negativeZero: '0.0' });
  });

  it.each(['', 'abc', '1e5', 'NaN', '1,5'])('refuses to write %j', async (value) => {
    await expect(codec.toWire(value, {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `sqlite/decimal@1 value must be decimal text, such as "12.50", got ${JSON.stringify(value)}`,
      meta: { codecId: 'sqlite/decimal@1', received: value },
    });
  });

  it('refuses to write a value that is not a string', async () => {
    await expect(codec.toWire(notString(12.5), {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      meta: { codecId: 'sqlite/decimal@1', received: '12.5' },
    });
  });

  it('reads stored decimal text as it is', async () => {
    expect(await codec.fromWire('12.50', {})).toBe('12.50');
  });

  it('raises a decode error naming the column when the stored text is not a decimal', async () => {
    await expect(
      codec.fromWire('', { column: { table: 'invoice', name: 'total' } }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'Column "invoice"."total" holds "", which is not decimal text. sqlite/decimal@1 reads decimal text, such as "12.50".',
      meta: { codecId: 'sqlite/decimal@1', table: 'invoice', column: 'total', received: '' },
    });
  });

  it('raises a decode error for a stored value it cannot read where no column is known', async () => {
    await expect(codec.fromWire(notString(12.5), {})).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'A sqlite/decimal@1 value is 12.5, which is not decimal text. sqlite/decimal@1 reads decimal text, such as "12.50".',
      meta: { codecId: 'sqlite/decimal@1', received: '12.5' },
    });
  });

  it('round-trips its contract form', () => {
    expect(toContractJson(codec, '012.50')).toBe('12.50');
    expect(fromContractJson(codec, '12.50')).toBe('12.50');
    expect(() => toContractJson(codec, 'twelve')).toThrow(
      expect.objectContaining({ code: 'RUNTIME.ENCODE_FAILED' }),
    );
  });

  it('renders a value literal as a string', () => {
    expect(sqliteDecimalStringDescriptor.renderValueLiteral('12.50')).toBe('"12.50"');
  });

  it('has a column helper on its codec', () => {
    expect(sqliteDecimalStringColumn()).toMatchObject({ codecId: 'sqlite/decimal@1' });
  });
});
