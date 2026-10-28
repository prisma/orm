import type { FieldInfo } from 'mariadb';
import { describe, expect, it } from 'vitest';
import { readTextOrBytes } from '../src/core/text-or-bytes';

const BINARY = 63;
const UTF8MB4 = 224;
const ZEROFILL = 1 << 6;
const NOT_FIXED = 31;

interface FieldShape {
  readonly type: string | undefined;
  readonly collation?: number;
  readonly text?: string | null;
  readonly number?: number | null;
  readonly flags?: number;
  readonly columnLength?: number;
  readonly scale?: number;
}

function field({
  type,
  collation = BINARY,
  text = 'text',
  number = 1,
  flags = 0,
  columnLength = 0,
  scale = 0,
}: FieldShape) {
  const calls: string[] = [];
  const value = {
    type,
    collation: { index: collation },
    flags,
    columnLength,
    scale,
    string: () => {
      calls.push('string');
      return text;
    },
    buffer: () => {
      calls.push('buffer');
      return text === null ? null : Buffer.from('bytes');
    },
    float: () => {
      calls.push('float');
      return number;
    },
  } as unknown as FieldInfo;
  return { value, calls };
}

const read = (shape: FieldShape) => readTextOrBytes(field(shape).value, () => 'next');

describe('readTextOrBytes', () => {
  it.each([
    ['INT', BINARY, 'string'],
    ['TINY', BINARY, 'string'],
    ['YEAR', BINARY, 'string'],
    ['FLOAT', BINARY, 'float'],
    ['DOUBLE', BINARY, 'float'],
    ['DATE', BINARY, 'string'],
    ['TIME', BINARY, 'string'],
    ['BIGINT', BINARY, 'string'],
    ['NEWDECIMAL', BINARY, 'string'],
    ['DATETIME', BINARY, 'string'],
    ['TIMESTAMP', BINARY, 'string'],
    ['JSON', BINARY, 'string'],
    ['ENUM', UTF8MB4, 'string'],
    ['SET', UTF8MB4, 'string'],
    ['VAR_STRING', UTF8MB4, 'string'],
    ['BLOB', UTF8MB4, 'string'],
    ['VAR_STRING', BINARY, 'buffer'],
    ['STRING', BINARY, 'buffer'],
    ['LONG_BLOB', BINARY, 'buffer'],
    ['BIT', BINARY, 'buffer'],
    ['GEOMETRY', BINARY, 'buffer'],
  ])('reads a %s column in collation %i with %s()', (type, collation, call) => {
    const { value, calls } = field({ type, collation });
    readTextOrBytes(value, () => 'next');
    expect(calls).toEqual([call]);
  });

  it('reads a column of a type the package has no name for, such as MySQL 9 VECTOR, as bytes and never as text', () => {
    const { value, calls } = field({ type: undefined, collation: BINARY });
    expect({ read: readTextOrBytes(value, () => 'next'), calls }).toEqual({
      read: new Uint8Array(Buffer.from('bytes')),
      calls: ['buffer'],
    });
  });

  it('returns bytes as a plain Uint8Array over the same memory, and NULL as null', () => {
    const bytes = read({ type: 'BLOB', collation: BINARY });
    expect({
      plain: bytes instanceof Uint8Array && !Buffer.isBuffer(bytes),
      bytes,
      nullBytes: read({ type: 'BIT', text: null }),
      nullText: read({ type: 'TIME', text: null }),
      nullNumber: read({ type: 'DOUBLE', number: null }),
    }).toEqual({
      plain: true,
      bytes: new Uint8Array(Buffer.from('bytes')),
      nullBytes: null,
      nullText: null,
      nullNumber: null,
    });
  });

  it('reads the same text for a column whether MySQL sent it as text or the package wrote it from binary', () => {
    const pairs = [
      { type: 'YEAR', columnLength: 4, flags: ZEROFILL, texts: ['0000', '0'] },
      { type: 'TINY', columnLength: 3, flags: ZEROFILL, texts: ['005', '5'] },
      { type: 'TIME', scale: 2, texts: ['25:00:00.50', '25:00:00.500000'] },
      { type: 'TIME', scale: 3, texts: ['-01:02:03.000', '-01:02:03'] },
      { type: 'TIME', scale: 0, texts: ['01:02:03', '01:02:03'] },
    ];
    expect(
      pairs.map(({ texts, ...shape }) => texts.map((text) => read({ ...shape, text }))),
    ).toEqual([
      ['0000', '0000'],
      ['005', '005'],
      ['25:00:00.50', '25:00:00.50'],
      ['-01:02:03.000', '-01:02:03.000'],
      ['01:02:03', '01:02:03'],
    ]);
  });

  it('reads a FLOAT as MySQL writes it over the text protocol: six significant digits, ties to even, and an exponent outside 1e-15 to 1e15', () => {
    const floats: readonly (readonly [number, string])[] = [
      [0.10000000149011612, '0.1'],
      [123456792, '123457000'],
      [8057845, '8057840'],
      [-123456.5, '-123456'],
      [3.3999999521443642e38, '3.4e38'],
      [999999986991104, '1e15'],
      [125148409626624, '125148000000000'],
      [1.0000000036274937e-15, '0.000000000000001'],
      [9.99999050715428e-16, '9.99999e-16'],
      [5.000000018137469e-16, '5e-16'],
      [1.401298464324817e-45, '1.4013e-45'],
      [1.1754943508222875e-38, '1.17549e-38'],
      [-2.5, '-2.5'],
      [0, '0'],
      [-0, '-0'],
    ];
    expect(floats.map(([number]) => read({ type: 'FLOAT', scale: NOT_FIXED, number }))).toEqual(
      floats.map(([, text]) => text),
    );
  });

  it('reads a DOUBLE as MySQL writes it over the text protocol: the shortest digits that read back as the same double, in fixed notation from 1e-15 and up to 1e15 or while digits follow the point', () => {
    const doubles: readonly (readonly [number, string])[] = [
      [0.1, '0.1'],
      [0.30000000000000004, '0.30000000000000004'],
      [1e-7, '0.0000001'],
      [1e-15, '0.000000000000001'],
      [1.2345678901234567e-14, '0.000000000000012345678901234567'],
      [1e-16, '1e-16'],
      [123456789012345.6, '123456789012345.6'],
      [999999999999999, '999999999999999'],
      [1e15, '1e15'],
      [9007199254740992, '9.007199254740992e15'],
      [4233813289058719.5, '4233813289058719.5'],
      [-1234567890123456.8, '-1234567890123456.8'],
      [1.2345678901234568e17, '1.2345678901234568e17'],
      [1e20, '1e20'],
      [1e21, '1e21'],
      [Number.MAX_VALUE, '1.7976931348623157e308'],
      [5e-324, '5e-324'],
      [-2.5, '-2.5'],
      [0, '0'],
      [-0, '-0'],
    ];
    expect(doubles.map(([number]) => read({ type: 'DOUBLE', scale: NOT_FIXED, number }))).toEqual(
      doubles.map(([, text]) => text),
    );
  });

  it('reads a FLOAT or DOUBLE declared with decimals as MySQL writes it over the text protocol: the shortest digits, rounded to the declared decimals ties to even or padded with zeros, in fixed notation', () => {
    const declared: readonly (readonly [string, number, number, string])[] = [
      ['FLOAT', 6, 1234.5677490234375, '1234.567749'],
      ['FLOAT', 6, 1234.567749, '1234.567749'],
      ['FLOAT', 6, 98765.4296875, '98765.429688'],
      ['FLOAT', 6, 0.10000000149011612, '0.100000'],
      ['FLOAT', 20, 0.10000000149011612, '0.10000000149011612000'],
      ['FLOAT', 1, 2097152.25, '2097152.2'],
      ['FLOAT', 1, 2097152.75, '2097152.8'],
      ['FLOAT', 1, -7, '-7.0'],
      ['DOUBLE', 2, 1.5, '1.50'],
      ['DOUBLE', 2, 100, '100.00'],
      ['DOUBLE', 2, -12345678.9, '-12345678.90'],
      ['DOUBLE', 2, 1e20, '100000000000000000000.00'],
      ['DOUBLE', 2, 0, '0.00'],
      ['DOUBLE', 2, -0, '-0.00'],
      ['FLOAT', 1, -0, '-0.0'],
      ['DOUBLE', 30, 1e-25, '0.000000000000000000000000100000'],
      ['DOUBLE', 30, 0.3333333333333333, '0.333333333333333300000000000000'],
      ['DOUBLE', 30, 123456789.12345679, '123456789.123456790000000000000000000000'],
      ['DOUBLE', 0, 5, '5'],
      ['DOUBLE', 0, -0, '-0'],
    ];
    expect(declared.map(([type, scale, number]) => read({ type, scale, number }))).toEqual(
      declared.map(([, , , text]) => text),
    );
  });
});
