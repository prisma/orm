import {
  integerLiteralTypesUpTo,
  type LiteralTypeDeclaration,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

const string = ['string'] as const;
const wholeNumbers = integerLiteralTypesUpTo('i64');

const EXPECTED: Readonly<Record<string, readonly LiteralTypeDeclaration[]>> = {
  'sql/char@1': string,
  'sql/varchar@1': string,
  'sql/int@1': integerLiteralTypesUpTo('i32'),
  'sql/float@1': [...wholeNumbers, 'bigint', 'decimal'],
  'sqlite/text@1': string,
  'sqlite/blob@1': string,
  'sqlite/datetime@1': string,
  'sqlite/integer@1': wholeNumbers,
  'sqlite/bigint@1': wholeNumbers,
  'sqlite/bigintnumber@1': wholeNumbers,
  'sqlite/real@1': [...wholeNumbers, 'bigint', 'decimal'],
  'sqlite/json@1': ['json'],
};

describe('sqlite literal type inventory', () => {
  it('registers codecs to check', () => {
    expect(codecDescriptors.length).toBeGreaterThan(0);
  });

  it('declares the literal types of every registered codec', () => {
    expect(
      Object.fromEntries(
        codecDescriptors.map((descriptor) => [descriptor.codecId, descriptor.literalTypes ?? []]),
      ),
    ).toEqual(EXPECTED);
  });
});
