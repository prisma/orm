import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  mysqlCharParams,
  mysqlDatetimeParams,
  mysqlDecimalParams,
  mysqlDurationParams,
  mysqlEnumParams,
  mysqlVarcharParams,
} from '../src/core/data-types';

describe('the parameters of a type, as a contract stores them', () => {
  it.each([
    ['mysqlDecimalParams', mysqlDecimalParams, { precision: 10, scale: 2 }],
    ['mysqlVarcharParams', mysqlVarcharParams, { length: 3 }],
    ['mysqlCharParams', mysqlCharParams, { length: 3 }],
    ['mysqlDatetimeParams', mysqlDatetimeParams, { precision: 3 }],
    ['mysqlDurationParams', mysqlDurationParams, { length: 3 }],
    ['mysqlEnumParams', mysqlEnumParams, { values: ['a'] }],
  ] as const)('%s refuses a key it does not define', (_, schema, params) => {
    expect(schema(params)).not.toBeInstanceOf(type.errors);
    const refused = schema({ ...params, unexpected: 1 });
    expect(refused instanceof type.errors ? refused.summary : 'accepted').toBe(
      'unexpected must be removed',
    );
  });
});
