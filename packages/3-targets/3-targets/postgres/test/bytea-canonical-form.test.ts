import { SqlColumnDefaultIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import { pgByteaDescriptor } from '../src/core/codecs';
import { pgBytea, pgText } from '../src/core/data-types';
import { toContractJson } from './contract-json';

const HELLO = 'aGVsbG8=';

describe('the canonical form of pg/bytea', () => {
  it.each([
    ['base64', HELLO, HELLO],
    ['PostgreSQL hex in lower case', '\\x68656c6c6f', HELLO],
    ['PostgreSQL hex in upper case', '\\x68656C6C6F', HELLO],
    ['bytes that need padding', '\\x0001', 'AAE='],
    ['empty PostgreSQL hex', '\\x', ''],
    ['empty base64', '', ''],
    ['base64 whose padding bits are not zero', 'aGVsbG9=', HELLO],
  ])('reads %s as the base64 the codec writes', (_name, value, canonical) => {
    expect(pgBytea.toCanonicalForm?.(value)).toBe(canonical);
  });

  it('is the base64 the bytea codec writes for the same bytes', () => {
    const codec = pgByteaDescriptor.factory()({ name: 'bytea-canonical-form' });
    const bytes = new Uint8Array([0, 1, 254, 255, 104, 105]);
    const hex = `\\x${Buffer.from(bytes).toString('hex')}`;
    expect(pgBytea.toCanonicalForm?.(hex)).toBe(toContractJson(codec, bytes));
  });

  it.each([
    [
      'hex with an odd number of digits',
      '\\x686',
      String.raw`"\\x686" is not PostgreSQL hex, which has two hexadecimal digits for each byte. Write base64, as in "aGVsbG8=", or PostgreSQL hex, written "\\x68656c6c6f" in a PSL string.`,
    ],
    [
      'hex with a digit that is not hexadecimal',
      '\\x6g',
      String.raw`"\\x6g" is not PostgreSQL hex, which has two hexadecimal digits for each byte. Write base64, as in "aGVsbG8=", or PostgreSQL hex, written "\\x68656c6c6f" in a PSL string.`,
    ],
    [
      'base64 without its padding',
      'aGVsbG8',
      String.raw`pg/bytea cannot read "aGVsbG8". Write base64 with its padding, as in "aGVsbG8=", or PostgreSQL hex, written "\\x68656c6c6f" in a PSL string.`,
    ],
    [
      'base64 with a character outside the standard alphabet',
      'aGVs-G8=',
      String.raw`pg/bytea cannot read "aGVs-G8=". Write base64 with its padding, as in "aGVsbG8=", or PostgreSQL hex, written "\\x68656c6c6f" in a PSL string.`,
    ],
    [
      'the text PostgreSQL prints in its escape format',
      'hello',
      String.raw`pg/bytea cannot read "hello". Write base64 with its padding, as in "aGVsbG8=", or PostgreSQL hex, written "\\x68656c6c6f" in a PSL string.`,
    ],
    [
      'hex written with one backslash in a PSL string, which reads \\x68 as h',
      'h656c6c6f',
      String.raw`pg/bytea cannot read "h656c6c6f". Write base64 with its padding, as in "aGVsbG8=", or PostgreSQL hex, written "\\x68656c6c6f" in a PSL string.`,
    ],
    ['a number', 42, 'Expected text, got 42.'],
    ['an array', [HELLO], 'Expected text, got ["aGVsbG8="].'],
  ])('refuses %s with a cast-level code', (_name, value, message) => {
    expect(() => pgBytea.toCanonicalForm?.(value)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED', message }),
    );
  });

  it('is the cast from pg/text, so a PSL default may be written in PostgreSQL hex', () => {
    expect({
      hex: pgBytea.casts[pgText.id]?.('\\x68656c6c6f'),
      base64: pgBytea.casts[pgText.id]?.(HELLO),
    }).toEqual({ hex: HELLO, base64: HELLO });
  });

  it('makes a default PostgreSQL prints in hex equal the base64 the contract stores', () => {
    const expected = (value: string | readonly string[]) =>
      new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value },
        nativeTypeContext: Array.isArray(value) ? 'bytea[]' : 'bytea',
        ...ifDefined('toCanonicalForm', pgBytea.toCanonicalForm),
      });
    const actual = (value: string | readonly string[]) =>
      new SqlColumnDefaultIR({ resolved: { kind: 'literal', value } });
    expect({
      scalar: expected(HELLO).isEqualTo(actual('\\x68656c6c6f')),
      empty: expected('').isEqualTo(actual('\\x')),
      list: expected([HELLO, 'AAE=']).isEqualTo(actual(['\\x68656c6c6f', '\\x0001'])),
      different: expected(HELLO).isEqualTo(actual('\\x6869')),
    }).toEqual({ scalar: true, empty: true, list: true, different: false });
  });
});
