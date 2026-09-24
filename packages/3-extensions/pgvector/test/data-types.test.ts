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
