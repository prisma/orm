import type { FieldInfo } from 'mariadb';
import { describe, expect, it } from 'vitest';
import { readTextOrBytes } from '../src/core/text-or-bytes';

const BINARY = 63;
const UTF8MB4 = 224;
const ZEROFILL = 1 << 6;

interface FieldShape {
  readonly type: string | undefined;
  readonly collation?: number;
  readonly text?: string | null;
  readonly flags?: number;
  readonly columnLength?: number;
  readonly scale?: number;
}

function field({
  type,
  collation = BINARY,
  text = 'text',
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
  } as unknown as FieldInfo;
  return { value, calls };
}

const read = (shape: FieldShape) => readTextOrBytes(field(shape).value, () => 'next');

describe('readTextOrBytes', () => {
  it.each([
    ['INT', BINARY, 'string'],
    ['TINY', BINARY, 'string'],
    ['YEAR', BINARY, 'string'],
    ['FLOAT', BINARY, 'string'],
    ['DOUBLE', BINARY, 'string'],
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
      nullText: read({ type: 'FLOAT', text: null }),
    }).toEqual({
      plain: true,
      bytes: new Uint8Array(Buffer.from('bytes')),
      nullBytes: null,
      nullText: null,
    });
  });

  it('reads the same text for a column whether MySQL sent it as text or the package wrote it from binary', () => {
    const pairs = [
      { type: 'YEAR', columnLength: 4, flags: ZEROFILL, texts: ['0000', '0'] },
      { type: 'TINY', columnLength: 3, flags: ZEROFILL, texts: ['005', '5'] },
      { type: 'TIME', scale: 2, texts: ['25:00:00.50', '25:00:00.500000'] },
      { type: 'TIME', scale: 3, texts: ['-01:02:03.000', '-01:02:03'] },
      { type: 'TIME', scale: 0, texts: ['01:02:03', '01:02:03'] },
      { type: 'DOUBLE', texts: ['1e21', '1e+21'] },
      { type: 'FLOAT', texts: ['3.4e38', '3.3999999521443642e+38'] },
      { type: 'FLOAT', texts: ['0.1', '0.10000000149011612'] },
    ];
    expect(
      pairs.map(({ texts, ...shape }) => texts.map((text) => read({ ...shape, text }))),
    ).toEqual([
      ['0000', '0000'],
      ['005', '005'],
      ['25:00:00.50', '25:00:00.50'],
      ['-01:02:03.000', '-01:02:03.000'],
      ['01:02:03', '01:02:03'],
      ['1e+21', '1e+21'],
      ['3.3999999521443642e+38', '3.3999999521443642e+38'],
      ['0.10000000149011612', '0.10000000149011612'],
    ]);
  });
});
