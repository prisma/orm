/**
 * Type tests for the pgvector codec (TML-2357).
 *
 * Mirrors `packages/3-targets/3-targets/postgres/test/codecs-class.types.test-d.ts`.
 *
 * Coverage selection:
 *
 * - literal preservation through `descriptor.factory({ length })` — `N` flows from the call site into the helper's `typeParams`.
 * - column helper preserves the typed `codecFactory` and the `{ length: N }` typeParams literal.
 * - positive `satisfies ColumnHelperFor` and `ColumnHelperForStrict`.
 * - one negative `// @ts-expect-error` for a wrong-shape malformed helper.
 */

import {
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
} from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import {
  type PgVectorCodec,
  type PgVectorDescriptor,
  pgVectorColumn,
  pgVectorDescriptor,
} from '../src/core/codecs';

test('pgVector: descriptor.factory(params) returns typed (ctx) => PgVectorCodec', () => {
  const factory = pgVectorDescriptor.factory({ length: 1536 });
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgVectorCodec>();
});

test('pgVector: column helper preserves typed codecFactory + length literal', () => {
  const col = pgVectorColumn(1536);
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => PgVectorCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<{ length: 1536 }>();
});

test('pgVector: column helper carries bare nativeType (family layer expands at emit/verify)', () => {
  const col = pgVectorColumn(1536);
  expectTypeOf(col.nativeType).toEqualTypeOf<string | undefined>();
  if (col.nativeType !== 'vector' || col.codecId !== 'pg/vector@1') {
    throw new Error(`nativeType / codecId mismatch: ${col.nativeType} / ${col.codecId}`);
  }
  if (col.typeParams.length !== 1536) {
    throw new Error(`length literal not preserved: ${col.typeParams.length}`);
  }
});

pgVectorColumn satisfies ColumnHelperFor<PgVectorDescriptor>;
pgVectorColumn satisfies ColumnHelperForStrict<PgVectorDescriptor>;

test('coarse satisfies catches wrong typeParams shape on pgVectorColumn', () => {
  const brokenHelper = (length: number) =>
    column(
      pgVectorDescriptor.factory({ length }),
      pgVectorDescriptor.codecId,
      { wrongKey: length },
      'vector',
    );
  // @ts-expect-error -- typeParams shape doesn't satisfy ColumnHelperFor<PgVectorDescriptor>
  brokenHelper satisfies ColumnHelperFor<PgVectorDescriptor>;
  // @ts-expect-error -- strict shape catches the same mismatch
  brokenHelper satisfies ColumnHelperForStrict<PgVectorDescriptor>;
});
