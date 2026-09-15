import { describe, expect, it } from 'vitest';
import {
  pgBoolDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgFloatDescriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgIntDescriptor,
} from '../src/core/codecs';
import { decodePostgresListText, parsePostgresListText } from '../src/core/list-decoder';

const instanceCtx = { name: '<test>' };
const callCtx = {};

type NumericWireDecoder = {
  decode: (wire: string | number, ctx: typeof callCtx) => number;
};

type BooleanWireDecoder = {
  decode: (wire: string | boolean, ctx: typeof callCtx) => boolean;
};

describe('parsePostgresListText', () => {
  it('parses raw text into elements', () => {
    expect(parsePostgresListText('{a,NULL,c}')).toEqual(['a', null, 'c']);
  });

  it('rejects non-string wire values', () => {
    expect(() => parsePostgresListText(['not', 'text'])).toThrow(
      'expected raw text for a Postgres array',
    );
  });
});

describe('decodePostgresListText', () => {
  it('parses raw text and decodes each non-null element', () => {
    const calls: unknown[] = [];

    const result = decodePostgresListText('{a,NULL,c}', (value) => {
      calls.push(value);
      return `DEC:${value}`;
    });

    expect(result).toEqual(['DEC:a', null, 'DEC:c']);
    expect(calls).toEqual(['a', 'c']);
  });

  it('handles empty arrays without invoking the element decoder', () => {
    let called = false;

    const result = decodePostgresListText('{}', (value) => {
      called = true;
      return value;
    });

    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it('returns decoded elements synchronously', () => {
    const result = decodePostgresListText('{1,2}', (value) => {
      return `${value}:${value}`;
    });

    expect(result).toEqual(['1:1', '2:2']);
  });

  it('rejects non-string wire values', () => {
    expect(() => decodePostgresListText(['not', 'text'], (value) => value)).toThrow(
      'expected raw text for a Postgres array',
    );
  });

  it('decodes raw int2/int4 element text through the bound scalar codecs', () => {
    const int2 = pgInt2Descriptor.factory()(instanceCtx) as NumericWireDecoder;
    const int4 = pgInt4Descriptor.factory()(instanceCtx) as NumericWireDecoder;
    const intAlias = pgIntDescriptor.factory()(instanceCtx) as NumericWireDecoder;

    expect(
      decodePostgresListText('{-32768,0,32767}', (value) => int2.decode(value as string, callCtx)),
    ).toEqual([-32768, 0, 32767]);
    expect(
      decodePostgresListText('{-2147483648,0,2147483647}', (value) =>
        int4.decode(value as string, callCtx),
      ),
    ).toEqual([-2147483648, 0, 2147483647]);
    expect(
      decodePostgresListText('{1,2}', (value) => intAlias.decode(value as string, callCtx)),
    ).toEqual([1, 2]);
  });

  it('decodes raw float element text including special values through the bound scalar codecs', () => {
    const float4 = pgFloat4Descriptor.factory()(instanceCtx) as NumericWireDecoder;
    const float8 = pgFloat8Descriptor.factory()(instanceCtx) as NumericWireDecoder;
    const floatAlias = pgFloatDescriptor.factory()(instanceCtx) as NumericWireDecoder;

    const decodedFloat4 = decodePostgresListText('{1.5,NaN,Infinity,-Infinity}', (value) =>
      float4.decode(value as string, callCtx),
    );
    const decodedFloat8 = decodePostgresListText('{-2.25,NaN,Infinity,-Infinity}', (value) =>
      float8.decode(value as string, callCtx),
    );
    const decodedFloatAlias = decodePostgresListText('{6.25,NaN}', (value) =>
      floatAlias.decode(value as string, callCtx),
    );

    expect(decodedFloat4[0]).toBe(1.5);
    expect(Number.isNaN(decodedFloat4[1])).toBe(true);
    expect(decodedFloat4.slice(2)).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    expect(decodedFloat8[0]).toBe(-2.25);
    expect(Number.isNaN(decodedFloat8[1])).toBe(true);
    expect(decodedFloat8.slice(2)).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    expect(decodedFloatAlias[0]).toBe(6.25);
    expect(Number.isNaN(decodedFloatAlias[1])).toBe(true);
  });

  it('decodes raw boolean element text through the bound scalar codec', () => {
    const bool = pgBoolDescriptor.factory()(instanceCtx) as BooleanWireDecoder;

    expect(
      decodePostgresListText('{t,f,t}', (value) => bool.decode(value as string, callCtx)),
    ).toEqual([true, false, true]);
  });
});
