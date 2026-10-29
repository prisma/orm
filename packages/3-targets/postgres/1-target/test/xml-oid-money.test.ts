import { describe, expect, it } from 'vitest';
import { pgMoneyDescriptor, pgOidDescriptor, pgXmlDescriptor } from '../src/core/codecs';
import {
  pgInt2,
  pgInt4,
  pgInt8,
  pgMoney,
  pgNumeric,
  pgOid,
  pgText,
  pgXml,
} from '../src/core/data-types';

const instanceCtx = { name: 'xml-oid-money' };
const callCtx = {};

const refusedBy = (owner: Record<string, string>) =>
  expect.objectContaining({ code: 'RUNTIME.DECODE_FAILED', meta: expect.objectContaining(owner) });

describe('pg/xml', () => {
  it('takes text through its cast and stores it unchanged', () => {
    expect(pgXml.valueFrom(pgXml.casts[pgText.id]?.('<a>b</a>') ?? null, {}).value).toBe(
      '<a>b</a>',
    );
  });

  it('refuses a value that is not text', () => {
    expect(() => pgXml.fromContract(1, {})).toThrow(refusedBy({ dataType: 'pg/xml' }));
  });

  it('has a codec that sends and reads text unchanged', async () => {
    const codec = pgXmlDescriptor.factory()(instanceCtx);
    expect([
      await codec.toWire('<a>b</a>', callCtx),
      await codec.fromWire('<a>b</a>', callCtx),
      codec.toDataTypeValue('<a/>').value,
    ]).toEqual(['<a>b</a>', '<a>b</a>', '<a/>']);
  });

  it('declares no equality, because PostgreSQL has no = operator for xml', () => {
    expect(pgXmlDescriptor.traits).toEqual([]);
  });
});

describe('pg/oid', () => {
  it.each([
    ['pg/int2', pgInt2.id, 0, 0],
    ['pg/int4', pgInt4.id, 42, 42],
    ['pg/int8', pgInt8.id, '4294967295', 4294967295],
  ])('casts a %s value to a number', (_name, source, value, converted) => {
    expect(pgOid.casts[source]?.(value)).toBe(converted);
  });

  it.each([
    ['a negative pg/int2', pgInt2.id, -1],
    ['a negative pg/int4', pgInt4.id, -70000],
    ['a pg/int8 past 4294967295', pgInt8.id, '4294967296'],
  ])('refuses %s with a cast-level code', (_name, source, value) => {
    expect(() => pgOid.casts[source]?.(value)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message: expect.stringContaining('from 0 to 4294967295'),
      }),
    );
  });

  it.each([-1, 4294967296, 1.5, '42'])('refuses %j as a stored value', (json) => {
    expect(() => pgOid.fromContract(json, {})).toThrow(refusedBy({ dataType: 'pg/oid' }));
  });

  it('has a codec that reads the text and the number PostgreSQL returns as a number', async () => {
    const codec = pgOidDescriptor.factory()(instanceCtx);
    expect([
      await codec.fromWire('4294967295', callCtx),
      await codec.fromWire(0, callCtx),
      await codec.toWire(42, callCtx),
      codec.toDataTypeValue(4294967295).value,
    ]).toEqual([4294967295, 0, 42, 4294967295]);
  });

  it('sends both ends of its range', async () => {
    const codec = pgOidDescriptor.factory()(instanceCtx);
    expect([await codec.toWire(0, callCtx), await codec.toWire(4294967295, callCtx)]).toEqual([
      0, 4294967295,
    ]);
  });

  it.each([-1, 4294967296, 1.5])(
    'refuses to send %j, which PostgreSQL would wrap or reject',
    async (value) => {
      const codec = pgOidDescriptor.factory()(instanceCtx);
      await expect(codec.toWire(value, callCtx)).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
        meta: { codecId: 'pg/oid@1', received: value },
      });
    },
  );
});

describe('pg/money', () => {
  it.each([
    ['pg/int2', pgInt2.id, 7, '7.00'],
    ['pg/int4', pgInt4.id, -70000, '-70000.00'],
    ['pg/int8', pgInt8.id, '92233720368547758', '92233720368547758.00'],
    ['pg/numeric', pgNumeric.id, '12.5', '12.50'],
    ['pg/numeric with trailing zeros', pgNumeric.id, '1.500', '1.50'],
    ['pg/numeric at the lower end', pgNumeric.id, '-92233720368547758.08', '-92233720368547758.08'],
  ])('casts a %s value to digit text with two fraction digits', (_name, source, value, stored) => {
    const cast = pgMoney.casts[source]?.(value) ?? null;
    expect(pgMoney.valueFrom(cast, {}).value).toBe(stored);
  });

  it.each([
    ['a third fraction digit', '1.234', 'two fraction digits'],
    ['a value past the upper end', '92233720368547758.08', '92233720368547758.07'],
    ['a value past the lower end', '-92233720368547758.09', '-92233720368547758.08'],
    ['NaN', 'NaN', 'two fraction digits'],
  ])('refuses %s from pg/numeric rather than rounding it', (_name, value, named) => {
    expect(() => pgMoney.casts[pgNumeric.id]?.(value)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message: expect.stringContaining(named),
      }),
    );
  });

  it.each(['12.5', '12', '012.50', '-0.00', 12.5])(
    'refuses %j as a stored value, which is digit text with exactly two fraction digits',
    (json) => {
      expect(() => pgMoney.fromContract(json, {})).toThrow(refusedBy({ dataType: 'pg/money' }));
    },
  );

  it.each(['12.50', '-1234.56', '0.00', '92233720368547758.07'])('reads %s as stored', (json) => {
    expect(pgMoney.fromContract(json, {}).value).toBe(json);
  });

  describe('its codec', () => {
    const codec = pgMoneyDescriptor.factory()(instanceCtx);

    it.each([
      ['$0.00', '0.00'],
      ['$12.50', '12.50'],
      ['$1,234.56', '1234.56'],
      ['-$1,234.56', '-1234.56'],
      ['-$0.05', '-0.05'],
      ['$92,233,720,368,547,758.07', '92233720368547758.07'],
      ['-$92,233,720,368,547,758.08', '-92233720368547758.08'],
    ])('reads %s, which PostgreSQL prints under lc_monetary C, as %s', async (wire, value) => {
      expect(await codec.fromWire(wire, callCtx)).toBe(value);
    });

    it.each([
      ['12.5', '12.50'],
      ['-1234.56', '-1234.56'],
      ['1000', '1000.00'],
    ])('reads %s, a numeral PostgreSQL reports for a default, as %s', async (wire, value) => {
      expect(await codec.fromWire(wire, callCtx)).toBe(value);
    });

    it.each([
      ['a German locale', '1.234,56 €'],
      ['a euro symbol', '€1,234.56'],
      ['a negative sign in parentheses', '($1,234.56)'],
      ['a misplaced thousands separator', '$12,34.56'],
    ])('refuses money text printed under %s, naming lc_monetary', async (_locale, wire) => {
      await expect(codec.fromWire(wire, callCtx)).rejects.toMatchObject({
        code: 'RUNTIME.LC_MONETARY_NOT_C',
        meta: { codecId: 'pg/money@1', received: wire },
        fix: expect.stringContaining('lc_monetary'),
      });
    });

    it('refuses a reported numeral with a third fraction digit, which money does not hold', async () => {
      await expect(codec.fromWire('1.234', callCtx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        meta: { codecId: 'pg/money@1', received: '1.234' },
      });
    });

    it('sends digit text with two fraction digits, which the adapter casts through numeric', async () => {
      expect([await codec.toWire('-1234.56', callCtx), await codec.toWire('7', callCtx)]).toEqual([
        '-1234.56',
        '7.00',
      ]);
    });

    it.each(['1.234', '$1.00', 'NaN', '1e3'])(
      'refuses to send %s, which PostgreSQL would round or misread',
      async (value) => {
        await expect(codec.toWire(value, callCtx)).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          meta: { codecId: 'pg/money@1', received: value },
        });
      },
    );

    it('gives a value in the stored spelling', () => {
      expect(codec.toDataTypeValue('12.5').value).toBe('12.50');
    });
  });
});
