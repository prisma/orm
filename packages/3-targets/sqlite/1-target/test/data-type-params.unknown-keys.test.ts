import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { sqliteCharacterLengthParams } from '../src/core/data-types';

describe('the parameters of a type, as a contract stores them', () => {
  it.each([['sqliteCharacterLengthParams', sqliteCharacterLengthParams, { length: 3 }]] as const)(
    '%s refuses a key it does not define',
    (_, schema, params) => {
      expect(schema(params)).not.toBeInstanceOf(type.errors);
      const refused = schema({ ...params, unexpected: 1 });
      expect(refused instanceof type.errors ? refused.summary : 'accepted').toBe(
        'unexpected must be removed',
      );
    },
  );
});
