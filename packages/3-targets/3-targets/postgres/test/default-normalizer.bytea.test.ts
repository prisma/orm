import { describe, expect, it } from 'vitest';
import { parsePostgresDefault, postgresResolveDefault } from '../src/core/default-normalizer';

describe('parsePostgresDefault bytea literals, read as PostgreSQL bytea input', () => {
  it.each([
    ['hex', "'\\x68656c6c6f'::bytea", 'aGVsbG8='],
    ['hex in upper case', "'\\x48454C4C4F'::bytea", 'SEVMTE8='],
    ['hex with spaces between its byte pairs', "'\\x68 65'::bytea", 'aGU='],
    ['empty hex', "'\\x'::bytea", ''],
    ['escape-format text', "'hello'::bytea", 'aGVsbG8='],
    ['escape-format text without a cast', "'hello'", 'aGVsbG8='],
    [
      'base64 text, which is escape-format text of its own characters',
      "'aGVsbG8='::bytea",
      'YUdWc2JHOD0=',
    ],
    ['a doubled backslash and octal escapes', "'a\\\\b\\001\\377'::bytea", 'YVxiAf8='],
    ['a character outside ASCII, as its UTF-8 bytes', "'é'::bytea", 'w6k='],
    ['empty text', "''::bytea", ''],
  ])('reads %s as the base64 of its bytes', (_name, rawDefault, base64) => {
    expect(parsePostgresDefault(rawDefault, 'bytea')).toEqual({ kind: 'literal', value: base64 });
  });

  it.each([
    ['hex with an odd number of digits', "'\\x686'::bytea"],
    ['hex with a digit that is not hexadecimal', "'\\x6g'::bytea"],
    ['a backslash that starts no escape', "'a\\qb'::bytea"],
    ['an octal escape past \\377', "'\\400'::bytea"],
  ])('keeps %s as the raw expression, because PostgreSQL does not read it', (_name, rawDefault) => {
    expect(parsePostgresDefault(rawDefault, 'bytea')).toEqual({
      kind: 'function',
      expression: rawDefault,
    });
  });

  it.each([
    ['an ARRAY[...] constructor', "ARRAY['\\x68656c6c6f'::bytea, 'hi'::bytea]"],
    ['an array literal', `'{"\\\\x68656c6c6f",hi}'::bytea[]`],
  ])('reads each element of %s as the base64 of its bytes', (_name, rawDefault) => {
    expect(parsePostgresDefault(rawDefault, 'bytea[]')).toEqual({
      kind: 'literal',
      value: ['aGVsbG8=', 'aGk='],
    });
  });

  it('keeps a list holding an element PostgreSQL does not read as the raw expression', () => {
    const rawDefault = "ARRAY['\\x68656c6c6f'::bytea, '\\x6'::bytea]";
    expect(parsePostgresDefault(rawDefault, 'bytea[]')).toEqual({
      kind: 'function',
      expression: rawDefault,
    });
  });
});

describe('postgresResolveDefault on a raw SQL bytea default', () => {
  it.each([
    ['escape-format text', "'hello'::bytea", 'aGVsbG8='],
    ['base64 text, as its own characters', "'aGVsbG8='::bytea", 'YUdWc2JHOD0='],
    ['hex, as the Prisma 7 reader writes it', "'\\x68656c6c6f'", 'aGVsbG8='],
  ])('reads %s as the base64 of its bytes', (_name, expression, base64) => {
    expect(postgresResolveDefault({ kind: 'function', expression }, 'bytea')).toEqual({
      kind: 'literal',
      value: base64,
    });
  });

  it('reads each element of a list the Prisma 7 reader writes', () => {
    expect(
      postgresResolveDefault(
        { kind: 'function', expression: "ARRAY['\\x68656c6c6f', 'hello']::BYTEA[]" },
        'bytea[]',
      ),
    ).toEqual({ kind: 'literal', value: ['aGVsbG8=', 'aGVsbG8='] });
  });
});
