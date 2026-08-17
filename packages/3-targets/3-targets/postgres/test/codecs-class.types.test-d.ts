/**
 * Type tests for the Postgres target codecs.
 *
 * Mirrors `packages/2-sql/4-lanes/relational-core/test/ast/sql-codecs.types.test-d.ts`.
 *
 * Representative codecs only — the framework-level type discipline is exercised in `framework-components/test/codec.types.test-d.ts`. Per-target coverage focuses on:
 *
 * - one void-param codec (`pgInt4`)
 * - one length-param codec (`pgBit`)
 * - one precision-param codec (`pgTimestamptz`)
 * - one composite-param codec (`pgNumeric` precision + scale)
 * - positive `satisfies ColumnHelperFor` and `ColumnHelperForStrict` on each
 * - one negative `// @ts-expect-error` for a wrong-shape malformed helper
 */

import {
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
} from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import {
  type PgBitCodec,
  type PgBitDescriptor,
  type PgInt4Codec,
  type PgInt4Descriptor,
  type PgInt8NumberCodec,
  type PgInt8NumberDescriptor,
  type PgNumericCodec,
  type PgNumericDescriptor,
  type PgUnboundedIntCodec,
  type PgUnboundedIntDescriptor,
  pgBitColumn,
  pgBitDescriptor,
  pgInt4Column,
  pgInt4Descriptor,
  pgInt8NumberColumn,
  pgInt8NumberDescriptor,
  pgNumericColumn,
  pgNumericDescriptor,
  pgUnboundedIntColumn,
  pgUnboundedIntDescriptor,
} from '../src/core/codecs';

test('pgInt4: descriptor.factory() returns typed (ctx) => PgInt4Codec', () => {
  const factory = pgInt4Descriptor.factory();
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgInt4Codec>();
});

test('pgInt4: column helper preserves typed codecFactory + undefined typeParams', () => {
  const col = pgInt4Column();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgInt4Codec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<undefined>();
});

test('integer representation column helpers preserve their application codec types', () => {
  expectTypeOf(pgInt8NumberColumn().codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => PgInt8NumberCodec
  >();
  expectTypeOf(pgUnboundedIntColumn().codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => PgUnboundedIntCodec
  >();
  expectTypeOf(pgInt8NumberColumn().typeParams).toEqualTypeOf<undefined>();
  expectTypeOf(pgUnboundedIntColumn().typeParams).toEqualTypeOf<undefined>();
});

test('pgBit: descriptor.factory(params) returns typed (ctx) => PgBitCodec', () => {
  const factory = pgBitDescriptor.factory({ length: 8 });
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgBitCodec>();
});

test('pgBit: column helper preserves typed codecFactory + length params', () => {
  const col = pgBitColumn({ length: 8 });
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgBitCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<{ readonly length?: number }>();
});

test('pgBit: column helper accepts no-args call (default params)', () => {
  const col = pgBitColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgBitCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<{ readonly length?: number }>();
});

test('pgNumeric: descriptor.factory(params) returns typed (ctx) => PgNumericCodec', () => {
  const factory = pgNumericDescriptor.factory({ precision: 10, scale: 2 });
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgNumericCodec>();
});

test('pgNumeric: column helper preserves typed codecFactory + composite params', () => {
  const col = pgNumericColumn({ precision: 10, scale: 2 });
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgNumericCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<{
    readonly precision?: number;
    readonly scale?: number;
  }>();
});

test('pgNumeric: column helper accepts no-args call (default params)', () => {
  const col = pgNumericColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgNumericCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<{
    readonly precision?: number;
    readonly scale?: number;
  }>();
});

pgInt4Column satisfies ColumnHelperFor<PgInt4Descriptor>;
pgInt4Column satisfies ColumnHelperForStrict<PgInt4Descriptor>;

pgInt8NumberColumn satisfies ColumnHelperFor<PgInt8NumberDescriptor>;
pgInt8NumberColumn satisfies ColumnHelperForStrict<PgInt8NumberDescriptor>;

pgUnboundedIntColumn satisfies ColumnHelperFor<PgUnboundedIntDescriptor>;
pgUnboundedIntColumn satisfies ColumnHelperForStrict<PgUnboundedIntDescriptor>;

pgInt8NumberDescriptor.factory() satisfies (ctx: CodecInstanceContext) => PgInt8NumberCodec;
pgUnboundedIntDescriptor.factory() satisfies (ctx: CodecInstanceContext) => PgUnboundedIntCodec;

pgBitColumn satisfies ColumnHelperFor<PgBitDescriptor>;
pgBitColumn satisfies ColumnHelperForStrict<PgBitDescriptor>;

pgNumericColumn satisfies ColumnHelperFor<PgNumericDescriptor>;
pgNumericColumn satisfies ColumnHelperForStrict<PgNumericDescriptor>;

test('coarse satisfies catches wrong typeParams shape on pgBitColumn', () => {
  const brokenHelper = (length: number) =>
    column(
      pgBitDescriptor.factory({ length }),
      pgBitDescriptor.codecId,
      { wrongKey: length },
      'bit',
    );
  // @ts-expect-error -- typeParams shape doesn't satisfy ColumnHelperFor<PgBitDescriptor>
  brokenHelper satisfies ColumnHelperFor<PgBitDescriptor>;
  // @ts-expect-error -- strict shape catches the same mismatch
  brokenHelper satisfies ColumnHelperForStrict<PgBitDescriptor>;
});
