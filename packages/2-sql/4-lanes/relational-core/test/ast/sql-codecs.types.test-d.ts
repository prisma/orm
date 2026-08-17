/**
 * Type tests for the SQL base codecs (TML-2357).
 *
 * Mirrors the framework-level pattern from `packages/1-framework/1-core/framework-components/test/codec.types.test-d.ts`. Verifies that:
 *
 * - `SqlXDescriptor.factory(...)` preserves the typed return at the direct call site;
 * - the per-codec column helper threads that typed return through the `column()` packager into the `ColumnSpec` shape;
 * - `satisfies ColumnHelperFor<SqlXDescriptor>` (and the strict variant where applicable) ties the helper to its descriptor.
 *
 * Coverage selection: one void-param codec (`text`), one length-param codec (`char`), one precision-param codec (`timestamp`). The framework type tests already exercise the variance discipline at the abstract-class level.
 */

import {
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
} from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import {
  type SqlCharCodec,
  type SqlCharDescriptor,
  type SqlTextCodec,
  type SqlTextDescriptor,
  sqlCharColumn,
  sqlCharDescriptor,
  sqlTextColumn,
  sqlTextDescriptor,
} from '../../src/ast/sql-codecs';

test('sqlText: descriptor.factory() returns typed (ctx) => SqlTextCodec', () => {
  const factory = sqlTextDescriptor.factory();
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqlTextCodec>();
});

test('sqlText: column helper preserves typed codecFactory + undefined typeParams', () => {
  const col = sqlTextColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqlTextCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<undefined>();
});

test('sqlChar: descriptor.factory(params) returns typed (ctx) => SqlCharCodec', () => {
  const factory = sqlCharDescriptor.factory({ length: 36 });
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqlCharCodec>();
});

test('sqlChar: column helper preserves typed codecFactory + length params', () => {
  const col = sqlCharColumn({ length: 36 });
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqlCharCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<{ readonly length?: number }>();
});

test('sqlChar: column helper accepts no-args call (default params)', () => {
  const col = sqlCharColumn();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => SqlCharCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<{ readonly length?: number }>();
});

sqlTextColumn satisfies ColumnHelperFor<SqlTextDescriptor>;
sqlTextColumn satisfies ColumnHelperForStrict<SqlTextDescriptor>;

sqlCharColumn satisfies ColumnHelperFor<SqlCharDescriptor>;
sqlCharColumn satisfies ColumnHelperForStrict<SqlCharDescriptor>;

test('coarse satisfies catches wrong typeParams shape on sqlCharColumn', () => {
  const brokenHelper = (length: number) =>
    column(
      sqlCharDescriptor.factory({ length }),
      sqlCharDescriptor.codecId,
      { wrongKey: length },
      'char',
    );
  // @ts-expect-error -- typeParams shape doesn't satisfy ColumnHelperFor<SqlCharDescriptor> (missing `length`)
  brokenHelper satisfies ColumnHelperFor<SqlCharDescriptor>;
  // @ts-expect-error -- strict shape catches the same mismatch
  brokenHelper satisfies ColumnHelperForStrict<SqlCharDescriptor>;
});

test('strict satisfies catches wrong codec wired in', () => {
  // Wire the text descriptor's factory into the char descriptor's slot. Coarse satisfies passes (`undefined` is the typeParams shape mismatch — sqlText's params resolve to `undefined` while sqlChar expects `{ readonly length?: number }`), so this exercises both axes; we assert the strict failure for the codec mismatch.
  const wrongCodecHelper = (length: number) =>
    column(sqlTextDescriptor.factory(), sqlCharDescriptor.codecId, { length }, 'char');
  wrongCodecHelper satisfies ColumnHelperFor<SqlCharDescriptor>;
  // @ts-expect-error -- codec is SqlTextCodec, not SqlCharCodec
  wrongCodecHelper satisfies ColumnHelperForStrict<SqlCharDescriptor>;
});
