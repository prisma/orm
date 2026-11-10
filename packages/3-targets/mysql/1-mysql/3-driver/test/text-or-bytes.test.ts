import type { FieldInfo } from 'mariadb';
import { describe, expect, it } from 'vitest';
import { readTextOrBytes } from '../src/core/text-or-bytes';

const BINARY = 63;
const UTF8MB4 = 224;

interface FieldShape {
  readonly type: string | undefined;
  readonly collation?: number;
  readonly text?: string | null;
}

function field({ type, collation = BINARY, text = 'text' }: FieldShape) {
  const calls: string[] = [];
  const value = {
    type,
    collation: { index: collation },
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
      nullText: read({ type: 'TIME', text: null }),
      nullNumber: read({ type: 'DOUBLE', text: null }),
    }).toEqual({
      plain: true,
      bytes: new Uint8Array(Buffer.from('bytes')),
      nullBytes: null,
      nullText: null,
      nullNumber: null,
    });
  });

  it('reads every text column as the text MySQL sent, without changing it', () => {
    const texts = [
      { type: 'YEAR', text: '0' },
      { type: 'TINY', text: '5' },
      { type: 'TIME', text: '-01:02:03.4' },
      { type: 'FLOAT', text: '3.4e38' },
      { type: 'DOUBLE', text: '-0' },
    ];
    expect(texts.map((shape) => read(shape))).toEqual(texts.map(({ text }) => text));
  });
});
