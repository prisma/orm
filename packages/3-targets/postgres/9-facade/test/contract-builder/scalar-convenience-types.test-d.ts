import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('each scalar convenience call has the type of the explicit type helper it chooses', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.Int()).toEqualTypeOf(type.Int4());
    expectTypeOf(type.Int({ storage: 'int2' })).toEqualTypeOf(type.Int2());
    expectTypeOf(type.BigInt()).toEqualTypeOf(type.Int8BigInt());
    expectTypeOf(type.BigInt({ as: 'number' })).toEqualTypeOf(type.Int8Number());
    expectTypeOf(type.BigInt({ storage: 'numeric' })).toEqualTypeOf(type.NumericBigInt());
    expectTypeOf(type.Float()).toEqualTypeOf(type.Float8());
    expectTypeOf(type.Float({ storage: 'float4' })).toEqualTypeOf(type.Float4());
    expectTypeOf(type.Decimal()).toEqualTypeOf(type.NumericString());
    expectTypeOf(type.Decimal({ precision: 10, scale: 2 })).toEqualTypeOf(
      type.NumericString(10, 2),
    );
    expectTypeOf(type.String()).toEqualTypeOf(type.Text());
    expectTypeOf(type.String({ storage: 'varchar', length: 12 })).toEqualTypeOf(type.Varchar(12));
    expectTypeOf(type.String({ storage: 'char', length: 3 })).toEqualTypeOf(type.Char(3));
    expectTypeOf(type.Boolean()).toEqualTypeOf(type.Bool());
    expectTypeOf(type.Bytes()).toEqualTypeOf(type.Bytea());
    return { models: {} };
  });
});

test('a scalar convenience call with no row does not compile', () => {
  defineContract({}, ({ type }) => {
    // @ts-expect-error no row stores a number as numeric
    type.BigInt({ as: 'number', storage: 'numeric' });
    // @ts-expect-error Text takes no length
    type.String({ length: 12 });
    return { models: {} };
  });
});

test('a deprecated explicit type name has the type of its replacement', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.SmallInt().codecId).toEqualTypeOf(type.Int2().codecId);
    expectTypeOf(type.VarChar(12).codecId).toEqualTypeOf(type.Varchar(12).codecId);
    expectTypeOf(type.Numeric(10, 2).codecId).toEqualTypeOf(type.NumericString(10, 2).codecId);
    return { models: {} };
  });
});
