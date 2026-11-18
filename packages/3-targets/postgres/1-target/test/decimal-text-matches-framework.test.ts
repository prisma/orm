import { storedNumeralText } from '@internal/framework-components/codec';
import { isDecimalText, printedDecimalText } from '@internal/type-implementations/decimal';
import { describe, expect, it } from 'vitest';

const NUMERALS = [
  '0',
  '-0',
  '0.0',
  '-0.00',
  '00.10',
  '007',
  '-007.50',
  '12.50',
  '1.000',
  '-0.001',
  '9007199254740993',
  '123456789012345678901234567890.123456789',
];

describe('the decimal text pg/numeric stores', () => {
  it('is the text the framework stores for a written numeral, so pg/numeric reads every default the classifier hands it', () => {
    expect(NUMERALS.every(isDecimalText)).toBe(true);
    expect(NUMERALS.map(printedDecimalText)).toEqual(NUMERALS.map(storedNumeralText));
  });
});
