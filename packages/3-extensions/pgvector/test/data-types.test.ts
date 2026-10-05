import { SqlColumnDefaultIR } from '@internal/sql-schema-ir/types';
import { pgInt2, pgInt4, pgInt8, pgNumeric, pgText } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import { pgvectorDataTypes, pgvectorVector } from '../src/core/data-types';

describe('pgvector/vector', () => {
  it('is the only data type this pack registers', () => {
    expect(pgvectorDataTypes.map((type) => type.id)).toEqual(['pgvector/vector']);
  });

  it('takes a list of the target numeric types and nothing else', () => {
    expect(pgvectorVector.listCast?.of).toEqual([pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id]);
    expect(pgvectorVector.listCast?.of).not.toContain(pgText.id);
  });

  it('casts from no scalar type, because a vector holds several numbers', () => {
    expect(Object.keys(pgvectorVector.casts)).toEqual([]);
  });

  it.each([
    ['numbers as written', [1, 2.5, -3], [1, 2.5, -3]],
    ['digit text from the wider whole-number types', ['42', '-7'], [42, -7]],
    ['decimal text from numeric', ['1.50', '0.25'], [1.5, 0.25]],
    ['an empty list', [], []],
  ])('reads %s', (_name, elements, converted) => {
    expect(pgvectorVector.listCast?.cast(elements)).toEqual(converted);
  });

  it.each([
    ['the word NaN', ['NaN']],
    ['the word Infinity', ['Infinity']],
    ['the word -Infinity', ['-Infinity']],
    ['text that is not a number', ['abc']],
    ['a boolean', [true]],
    ['a document', [{ a: 1 }]],
  ])('refuses %s as an element', (_name, elements) => {
    expect(() => pgvectorVector.listCast?.cast(elements)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.CAST_REFUSED' }),
    );
  });
});

describe('the canonical form of pgvector/vector', () => {
  it.each([
    ['an array of numbers', [1, 2.5, -3], [1, 2.5, -3]],
    ['the text PostgreSQL prints', '[1,2,3]', [1, 2, 3]],
    ['printed negatives and fractions', '[-1.5,0,0.25]', [-1.5, 0, 0.25]],
    ['a printed exponent', '[1e-05,2.5E+3]', [0.00001, 2500]],
    ['printed text with spaces', '[ 1, 2 ,3 ]', [1, 2, 3]],
  ])('reads %s as the array of numbers', (_name, value, canonical) => {
    expect(pgvectorVector.toCanonicalForm?.(value)).toEqual(canonical);
  });

  it('leaves an array of numbers as it is', () => {
    const value = [1, 2, 3];
    expect(pgvectorVector.toCanonicalForm?.(value)).toBe(value);
  });

  it.each([
    ['text without brackets', '1,2,3'],
    ['text that is not a number', '[1,a,3]'],
    ['an empty element', '[1,,3]'],
    ['a number with trailing text', '[1abc]'],
    ['the word NaN', '[NaN]'],
    ['the word Infinity', '[Infinity]'],
    ['an array of digit text', ['1', '2']],
    ['a number', 1],
    ['a boolean', true],
    ['a document', { a: 1 }],
  ])('refuses %s with a cast-level code', (_name, value) => {
    expect(() => pgvectorVector.toCanonicalForm?.(value)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CAST_REFUSED',
        message: `A vector is an array of finite numbers, or the text PostgreSQL prints for one, as in "[1,2,3]". ${JSON.stringify(value)} is neither.`,
      }),
    );
  });

  it('adds no cast from text', () => {
    expect(pgvectorVector.casts).toEqual({});
  });

  it('makes a list default PostgreSQL prints as text equal the arrays the contract stores', () => {
    const expected = (value: readonly (readonly number[])[]) =>
      new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value },
        nativeTypeContext: 'vector(3)[]',
        dataType: pgvectorVector,
      });
    const actual = (value: readonly string[]) =>
      new SqlColumnDefaultIR({
        resolved: { kind: 'literal', value },
        nativeTypeContext: 'vector(3)[]',
      });
    expect({
      list: expected([
        [1, 2, 3],
        [4, 5, 6],
      ]).isEqualTo(actual(['[1,2,3]', '[4,5,6]'])),
      different: expected([[1, 2, 3]]).isEqualTo(actual(['[1,2,4]'])),
    }).toEqual({ list: true, different: false });
  });
});
