import {
  type AnyCodecDescriptor,
  integerLiteralTypesUpTo,
  type LiteralTypeDeclaration,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import * as sqlCodecs from '../src/ast/sql-codecs';

const string = ['string'] as const;

const EXPECTED: Readonly<Record<string, readonly LiteralTypeDeclaration[]>> = {
  'sql/text@1': string,
  'sql/char@1': string,
  'sql/varchar@1': string,
  'sql/int@1': integerLiteralTypesUpTo('i32'),
  'sql/float@1': [...integerLiteralTypesUpTo('i64'), 'bigint', 'decimal'],
};

const isDescriptor = (value: unknown): value is AnyCodecDescriptor =>
  typeof value === 'object' &&
  value !== null &&
  'codecId' in value &&
  typeof value.codecId === 'string' &&
  'traits' in value &&
  'factory' in value;

const moduleExports: readonly unknown[] = Object.values(sqlCodecs);
const descriptors = moduleExports.filter(isDescriptor);

describe('relational-core literal type inventory', () => {
  it('registers codecs to check', () => {
    expect(descriptors.length).toBeGreaterThan(0);
  });

  it('declares the literal types of every registered codec', () => {
    expect(
      Object.fromEntries(
        descriptors.map((descriptor) => [descriptor.codecId, descriptor.literalTypes ?? []]),
      ),
    ).toEqual(EXPECTED);
  });
});
