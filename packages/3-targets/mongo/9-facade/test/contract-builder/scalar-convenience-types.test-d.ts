import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('each scalar convenience call has the type of the explicit type helper it chooses', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.Int()).toEqualTypeOf(type.Int32());
    expectTypeOf(type.Int({ storage: 'int' })).toEqualTypeOf(type.Int32());
    expectTypeOf(type.BigInt()).toEqualTypeOf(type.Int64BigInt());
    expectTypeOf(type.BigInt({ as: 'number' })).toEqualTypeOf(type.Int64Number());
    expectTypeOf(type.Float()).toEqualTypeOf(type.Double());
    expectTypeOf(type.Decimal()).toEqualTypeOf(type.Decimal128());
    expectTypeOf(type.Boolean()).toEqualTypeOf(type.Bool());
    expectTypeOf(type.Bytes()).toEqualTypeOf(type.Binary());
    expectTypeOf(type.String()).toEqualTypeOf(type.BsonString());
    expectTypeOf(type.Json()).toEqualTypeOf(type.PlainJson());
    expectTypeOf(type.Json({ storage: 'bson' })).toEqualTypeOf(type.PlainJson());
    expectTypeOf(type.Int().codecId).toEqualTypeOf<'mongo/int32@1'>();
    expectTypeOf(type.BigInt().codecId).toEqualTypeOf<'mongo/int64@1'>();
    expectTypeOf(type.BigInt({ as: 'number' }).codecId).toEqualTypeOf<'mongo/int64Number@1'>();
    expectTypeOf(type.Float().codecId).toEqualTypeOf<'mongo/double@1'>();
    expectTypeOf(type.Decimal().codecId).toEqualTypeOf<'mongo/decimal128@1'>();
    expectTypeOf(type.Boolean().codecId).toEqualTypeOf<'mongo/bool@1'>();
    expectTypeOf(type.Bytes().codecId).toEqualTypeOf<'mongo/binary@1'>();
    expectTypeOf(type.String().codecId).toEqualTypeOf<'mongo/string@1'>();
    expectTypeOf(type.Json().codecId).toEqualTypeOf<'mongo/json@1'>();
    return { models: {} };
  });
});

test('a scalar convenience call with no row does not compile', () => {
  defineContract({}, ({ type }) => {
    // @ts-expect-error Int stores only int
    type.Int({ storage: 'long' });
    // @ts-expect-error BigInt reads only bigint or number
    type.BigInt({ as: 'string' });
    // @ts-expect-error Json stores only bson
    type.Json({ storage: 'string' });
    // @ts-expect-error Json has no as option
    type.Json({ as: 'string' });
    return { models: {} };
  });
});

test('Int64 is a PSL name only, and the renamed explicit types have helpers', () => {
  defineContract({}, ({ type }) => {
    // @ts-expect-error Int64 is renamed Int64BigInt
    type.Int64();
    expectTypeOf(type.Int64BigInt().codecId).toEqualTypeOf<'mongo/int64@1'>();
    expectTypeOf(type.BsonString().codecId).toEqualTypeOf<'mongo/string@1'>();
    expectTypeOf(type.PlainJson().codecId).toEqualTypeOf<'mongo/json@1'>();
    return { models: {} };
  });
});
