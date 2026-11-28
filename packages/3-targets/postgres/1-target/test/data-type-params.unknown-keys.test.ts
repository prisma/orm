import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  pgBitLengthParams,
  pgCharacterLengthParams,
  pgEnumParams,
  pgNumericParams,
  pgPrecisionParams,
} from '../src/core/data-types';

describe('the parameters of a type, as a contract stores them', () => {
  it.each([
    ['pgNumericParams', pgNumericParams, { precision: 10, scale: 2 }],
    ['pgCharacterLengthParams', pgCharacterLengthParams, { length: 3 }],
    ['pgBitLengthParams', pgBitLengthParams, { length: 3 }],
    ['pgPrecisionParams', pgPrecisionParams, { precision: 3 }],
    ['pgEnumParams', pgEnumParams, { typeName: 'mood' }],
  ] as const)('%s refuses a key it does not define', (_, schema, params) => {
    expect(schema(params)).not.toBeInstanceOf(type.errors);
    const refused = schema({ ...params, unexpected: 1 });
    expect(refused instanceof type.errors ? refused.summary : 'accepted').toBe(
      'unexpected must be removed',
    );
  });
});
