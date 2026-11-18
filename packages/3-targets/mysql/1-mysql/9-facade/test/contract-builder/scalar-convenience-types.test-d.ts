import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('each scalar convenience call has the type of the explicit type helper it chooses', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.Int()).toEqualTypeOf(type.Int4());
    expectTypeOf(type.Int({ storage: 'int' })).toEqualTypeOf(type.Int4());
    expectTypeOf(type.BigInt()).toEqualTypeOf(type.Int8BigInt());
    expectTypeOf(type.BigInt({ as: 'number' })).toEqualTypeOf(type.Int8Number());
    expectTypeOf(type.Float()).toEqualTypeOf(type.Float8());
    expectTypeOf(type.Float({ storage: 'double' })).toEqualTypeOf(type.Float8());
    expectTypeOf(type.String({ storage: 'text' })).toEqualTypeOf(type.Text());
    expectTypeOf(type.Int4().codecId).toEqualTypeOf<'mysql/int@1'>();
    expectTypeOf(type.Int8BigInt().codecId).toEqualTypeOf<'mysql/bigint@1'>();
    expectTypeOf(type.Int8Number().codecId).toEqualTypeOf<'mysql/bigintnumber@1'>();
    expectTypeOf(type.Float8().codecId).toEqualTypeOf<'mysql/double@1'>();
    expectTypeOf(type.NumericString().codecId).toEqualTypeOf<'mysql/decimal@1'>();
    expectTypeOf(type.Decimal().codecId).toEqualTypeOf<'mysql/decimal@1'>();
    expectTypeOf(
      type.Decimal({ precision: 10, scale: 2 }).codecId,
    ).toEqualTypeOf<'mysql/decimal@1'>();
    expectTypeOf(type.Varchar(40).codecId).toEqualTypeOf<'sql/varchar@1'>();
    expectTypeOf(type.String().codecId).toEqualTypeOf<'sql/varchar@1'>();
    expectTypeOf(type.String({ length: 40 }).codecId).toEqualTypeOf<'sql/varchar@1'>();
    expectTypeOf(type.Text().codecId).toEqualTypeOf<'mysql/text@1'>();
    expectTypeOf(type.Boolean()).toEqualTypeOf(type.Bool());
    expectTypeOf(type.Boolean({ storage: 'tinyint' })).toEqualTypeOf(type.Bool());
    expectTypeOf(type.Bytes()).toEqualTypeOf(type.Longblob());
    expectTypeOf(type.Bytes({ storage: 'longblob' })).toEqualTypeOf(type.Longblob());
    expectTypeOf(type.Json()).toEqualTypeOf(type.PlainJson());
    expectTypeOf(type.Json({ storage: 'json' })).toEqualTypeOf(type.PlainJson());
    expectTypeOf(type.Bool().codecId).toEqualTypeOf<'mysql/boolean@1'>();
    expectTypeOf(type.Longblob().codecId).toEqualTypeOf<'mysql/longblob@1'>();
    expectTypeOf(type.PlainJson().codecId).toEqualTypeOf<'mysql/json@1'>();
    return { models: {} };
  });
});

test('a scalar convenience call with no row does not compile', () => {
  defineContract({}, ({ type }) => {
    // @ts-expect-error Int stores only int
    type.Int({ storage: 'bigint' });
    // @ts-expect-error BigInt reads only bigint or number
    type.BigInt({ as: 'string' });
    // @ts-expect-error Float stores only double; float is not offered
    type.Float({ storage: 'float' });
    // @ts-expect-error Decimal stores only decimal
    type.Decimal({ storage: 'numeric' });
    // @ts-expect-error String stores varchar or text
    type.String({ storage: 'char' });
    // @ts-expect-error Float has no as option
    type.Float({ as: 'number' });
    // @ts-expect-error Boolean stores only tinyint
    type.Boolean({ storage: 'bit' });
    // @ts-expect-error Bytes stores only longblob
    type.Bytes({ storage: 'blob' });
    // @ts-expect-error Json stores only json
    type.Json({ storage: 'jsonb' });
    // @ts-expect-error Json has no as option
    type.Json({ as: 'string' });
    return { models: {} };
  });
});
