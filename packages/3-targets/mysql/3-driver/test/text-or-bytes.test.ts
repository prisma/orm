import type { FieldInfo } from 'mariadb';
import { describe, expect, it } from 'vitest';
import { readTextOrBytes } from '../src/core/text-or-bytes';

const BINARY = 63;
const UTF8MB4 = 224;

function field(type: string, collation: number) {
  const calls: string[] = [];
  const value = {
    type,
    collation: { index: collation },
    string: () => {
      calls.push('string');
      return 'text';
    },
    buffer: () => {
      calls.push('buffer');
      return Buffer.from('bytes');
    },
  } as unknown as FieldInfo;
  return { value, calls };
}

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
    ['VAR_STRING', UTF8MB4, 'string'],
    ['BLOB', UTF8MB4, 'string'],
    ['VAR_STRING', BINARY, 'buffer'],
    ['STRING', BINARY, 'buffer'],
    ['LONG_BLOB', BINARY, 'buffer'],
    ['BIT', BINARY, 'buffer'],
    ['GEOMETRY', BINARY, 'buffer'],
  ])('reads a %s column in collation %i with %s()', (type, collation, call) => {
    const { value, calls } = field(type, collation);
    readTextOrBytes(value, () => 'next');
    expect(calls).toEqual([call]);
  });
});
