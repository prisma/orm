import {
  integerLiteralTypesUpTo,
  type LiteralTypeDeclaration,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

const string = ['string'] as const;
const wholeNumbers = integerLiteralTypesUpTo('i64');
const exactDecimals = [...wholeNumbers, 'bigint', 'decimal'] as const;
const everyNumber = [...exactDecimals, 'float'] as const;

const EXPECTED: Readonly<Record<string, readonly LiteralTypeDeclaration[]>> = {
  'sql/char@1': string,
  'sql/varchar@1': string,
  'sql/text@1': string,
  'sql/int@1': integerLiteralTypesUpTo('i32'),
  'sql/float@1': exactDecimals,
  'pg/text@1': string,
  'pg/char@1': string,
  'pg/varchar@1': string,
  'pg/uuid@1': string,
  'pg/inet@1': string,
  'pg/bit@1': string,
  'pg/varbit@1': string,
  'pg/timetz@1': string,
  'pg/interval@1': string,
  'pg/bytea@1': string,
  'pg/date-string@1': string,
  'pg/time-string@1': string,
  'pg/timestamp-string@1': string,
  'pg/timestamptz-string@1': string,
  'pg/date-temporal@1': string,
  'pg/time-temporal@1': string,
  'pg/timestamp-temporal@1': string,
  'pg/timestamptz-temporal@1': string,
  'pg/timestamptz-date@1': string,
  'pg/bool@1': ['boolean'],
  'pg/int2@1': integerLiteralTypesUpTo('i16'),
  'pg/int4@1': integerLiteralTypesUpTo('i32'),
  'pg/int@1': integerLiteralTypesUpTo('i32'),
  'pg/int8@1': wholeNumbers,
  'pg/int8number@1': wholeNumbers,
  'pg/unboundedint@1': [...wholeNumbers, 'bigint'],
  'pg/float@1': exactDecimals,
  'pg/float4@1': everyNumber,
  'pg/float8@1': everyNumber,
  'pg/numeric@1': everyNumber,
  'pg/json@1': ['json'],
  'pg/jsonb@1': ['json'],
  'pg/enum@1': [],
  'pg/text-array@1': [],
};

describe('postgres literal type inventory', () => {
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
