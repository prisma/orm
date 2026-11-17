import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('each scalar convenience call has the type of the explicit type helper it chooses', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.Int()).toEqualTypeOf(type.IntegerNumber());
    expectTypeOf(type.Int({ storage: 'integer' })).toEqualTypeOf(type.IntegerNumber());
    expectTypeOf(type.BigInt()).toEqualTypeOf(type.IntegerBigInt());
    expectTypeOf(type.BigInt({ as: 'number' })).toEqualTypeOf(type.IntegerNumber());
    expectTypeOf(type.Float()).toEqualTypeOf(type.Real());
    expectTypeOf(type.Decimal()).toEqualTypeOf(type.DecimalString());
    expectTypeOf(type.Decimal({ storage: 'text' })).toEqualTypeOf(type.DecimalString());
    expectTypeOf(type.BigIntNumber()).toEqualTypeOf(type.IntegerNumber());
    expectTypeOf(type.String()).toEqualTypeOf(type.Text());
    expectTypeOf(type.Bytes()).toEqualTypeOf(type.Blob());
    expectTypeOf(type.Json()).toEqualTypeOf(type.PlainJson());
    expectTypeOf(type.Json({ storage: 'text' })).toEqualTypeOf(type.PlainJson());
    expectTypeOf(type.IntegerNumber().codecId).toEqualTypeOf<'sqlite/integer@1'>();
    expectTypeOf(type.IntegerBigInt().codecId).toEqualTypeOf<'sqlite/bigint@1'>();
    expectTypeOf(type.Real().codecId).toEqualTypeOf<'sqlite/real@1'>();
    expectTypeOf(type.DecimalString().codecId).toEqualTypeOf<'sqlite/decimal@1'>();
    expectTypeOf(type.Text().codecId).toEqualTypeOf<'sqlite/text@1'>();
    expectTypeOf(type.Blob().codecId).toEqualTypeOf<'sqlite/blob@1'>();
    expectTypeOf(type.PlainJson().codecId).toEqualTypeOf<'sqlite/json@1'>();
    return { models: {} };
  });
});

test('a scalar convenience call with no row does not compile', () => {
  defineContract({}, ({ type }) => {
    // @ts-expect-error Int stores only integer
    type.Int({ storage: 'text' });
    // @ts-expect-error BigInt reads only bigint or number
    type.BigInt({ as: 'string' });
    // @ts-expect-error Json stores only text
    type.Json({ storage: 'jsonb' });
    // @ts-expect-error Json has no as option
    type.Json({ as: 'string' });
    // @ts-expect-error Decimal stores only text
    type.Decimal({ storage: 'real' });
    // @ts-expect-error Float has no as option
    type.Float({ as: 'number' });
    return { models: {} };
  });
});
