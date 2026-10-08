/**
 * Type tests for the SQLite target codecs.
 *
 * Mirrors `packages/3-targets/3-targets/postgres/test/codecs-class.types.test-d.ts`.
 *
 * Coverage selection: every SQLite codec is non-parameterized, so the tests focus on representative codecs that exercise distinct input/wire types — a numeric (`integer`), a typed `Date` mapping (`datetime`, wire `string` ≠ input `Date`), a binary mapping (`blob`, wire `Uint8Array`), and a bigint mapping (`bigint`, wire `number | bigint` ≠ input `bigint`). The framework-level type discipline is exercised in `framework-components/test/codec.types.test-d.ts`.
 */

import {
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
} from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import {
  type SqliteBigintCodec,
  type SqliteBigintDescriptor,
  type SqliteBigintNumberCodec,
  type SqliteBigintNumberDescriptor,
  type SqliteBlobCodec,
  type SqliteBlobDescriptor,
  type SqliteDatetimeCodec,
  type SqliteDatetimeDescriptor,
  type SqliteIntegerCodec,
  type SqliteIntegerDescriptor,
  sqliteBigintColumn,
  sqliteBigintDescriptor,
  sqliteBigintNumberColumn,
  sqliteBigintNumberDescriptor,
  sqliteBlobColumn,
  sqliteBlobDescriptor,
  sqliteDatetimeColumn,
  sqliteDatetimeDescriptor,
  sqliteIntegerColumn,
  sqliteIntegerDescriptor,
} from '../src/core/codecs';

test('sqliteInteger: descriptor.factory() returns typed (ctx) => SqliteIntegerCodec', () => {
  const factory = sqliteIntegerDescriptor.factory();
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqliteIntegerCodec>();
});

test('sqliteInteger: column helper preserves typed codecFactory + undefined typeParams', () => {
  const col = sqliteIntegerColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqliteIntegerCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<undefined>();
});

test('sqliteDatetime: column preserves the wire-string / input-Date split', () => {
  const factory = sqliteDatetimeDescriptor.factory();
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqliteDatetimeCodec>();
  const col = sqliteDatetimeColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => SqliteDatetimeCodec
  >();
});

test('sqliteBlob: column preserves Uint8Array codec type', () => {
  const factory = sqliteBlobDescriptor.factory();
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqliteBlobCodec>();
  const col = sqliteBlobColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqliteBlobCodec>();
});

test('sqliteBigint: column preserves the (number|bigint) wire / bigint input split', () => {
  const factory = sqliteBigintDescriptor.factory();
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqliteBigintCodec>();
  const col = sqliteBigintColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqliteBigintCodec>();
});

test('sqliteBigintNumber: column helper preserves its number application codec type', () => {
  const col = sqliteBigintNumberColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => SqliteBigintNumberCodec
  >();
  expectTypeOf(col.typeParams).toEqualTypeOf<undefined>();
});

sqliteIntegerColumn satisfies ColumnHelperFor<SqliteIntegerDescriptor>;
sqliteIntegerColumn satisfies ColumnHelperForStrict<SqliteIntegerDescriptor>;

sqliteDatetimeColumn satisfies ColumnHelperFor<SqliteDatetimeDescriptor>;
sqliteDatetimeColumn satisfies ColumnHelperForStrict<SqliteDatetimeDescriptor>;

sqliteBlobColumn satisfies ColumnHelperFor<SqliteBlobDescriptor>;
sqliteBlobColumn satisfies ColumnHelperForStrict<SqliteBlobDescriptor>;

sqliteBigintColumn satisfies ColumnHelperFor<SqliteBigintDescriptor>;
sqliteBigintColumn satisfies ColumnHelperForStrict<SqliteBigintDescriptor>;

sqliteBigintNumberColumn satisfies ColumnHelperFor<SqliteBigintNumberDescriptor>;
sqliteBigintNumberColumn satisfies ColumnHelperForStrict<SqliteBigintNumberDescriptor>;
sqliteBigintNumberDescriptor.factory() satisfies (
  ctx: CodecInstanceContext,
) => SqliteBigintNumberCodec;

test('strict satisfies catches wrong codec wired in', () => {
  // Wire the integer descriptor's factory into the bigint descriptor's slot. Coarse satisfies passes (both have `void` typeParams); strict satisfies fails because the codec types differ (SqliteIntegerCodec ≠ SqliteBigintCodec).
  const wrongCodecHelper = () =>
    column(sqliteIntegerDescriptor.factory(), sqliteBigintDescriptor.codecId, undefined);
  wrongCodecHelper satisfies ColumnHelperFor<SqliteBigintDescriptor>;
  // @ts-expect-error -- codec is SqliteIntegerCodec, not SqliteBigintCodec
  wrongCodecHelper satisfies ColumnHelperForStrict<SqliteBigintDescriptor>;
});
