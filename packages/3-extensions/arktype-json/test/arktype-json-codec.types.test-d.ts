/**
 * Type tests for the arktype-json codec (TML-2357).
 *
 * Spec § Case 3: method-level generic over `S extends Type<unknown>`. Coverage focuses on the literal-preservation property — `S['infer']` flows from the column-author site through `arktypeJsonColumn` into the resolved codec's `TInput` slot. Exercises that:
 *
 * - the helper's return-type `codecFactory` slot carries `ArktypeJsonCodecClass<S['infer']>`, with the schema's TS-level inferred shape preserved.
 * - the column spec's `codecId` is `'arktype/json@1'`.
 * - `ColumnInputType` extraction recovers the schema's inferred shape.
 * - the descriptor's factory returns the erased `ArktypeJsonCodecClass<unknown>` form (since `S` is unavailable at descriptor-factory time; only the IR is).
 * - `satisfies ColumnHelperFor<ArktypeJsonDescriptor>` (coarse) succeeds; `ColumnHelperForStrict` is intentionally not applied because `Codec` is invariant in `TInput` (see codec-class.ts comment).
 *
 * Negative tests cover the `ColumnHelperFor` typeParams-shape check.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type CodecInstanceContext,
  type CodecTrait,
  type ColumnHelperFor,
  type ColumnSpec,
  column,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import { pgJsonb } from '@internal/target-postgres/data-types';
import { type } from 'arktype';
import { expectTypeOf, test } from 'vitest';
import {
  type ArktypeJsonCodecClass,
  type ArktypeJsonDescriptor,
  type ArktypeJsonTypeParams,
  arktypeJsonColumn,
  arktypeJsonDescriptor,
} from '../src/core/arktype-json-codec';

test('arktypeJsonColumn: schema infer preserved through codecFactory return', () => {
  const ProductSchema = type({ name: 'string', price: 'number' });
  const col = arktypeJsonColumn(ProductSchema);
  expectTypeOf(col.codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => ArktypeJsonCodecClass<{ name: string; price: number }>
  >();
});

test('arktypeJsonColumn: typeParams shape is ArktypeJsonTypeParams', () => {
  const ProductSchema = type({ name: 'string', price: 'number' });
  const col = arktypeJsonColumn(ProductSchema);
  expectTypeOf(col.typeParams).toEqualTypeOf<ArktypeJsonTypeParams>();
});

test('arktypeJsonColumn: codecId literal', () => {
  const ProductSchema = type({ name: 'string', price: 'number' });
  const col = arktypeJsonColumn(ProductSchema);
  expectTypeOf(col.codecId).toEqualTypeOf<string>();
  if (col.codecId !== 'arktype/json@1') {
    throw new Error(`codecId mismatch: ${col.codecId}`);
  }
});

test('ColumnInputType extracts the schema-inferred TS type', () => {
  type ResolvedCodec<C> = C extends { codecFactory: (ctx: CodecInstanceContext) => infer R }
    ? R
    : never;
  type ColumnInputType<C> =
    ResolvedCodec<C> extends Codec<string, readonly CodecTrait[], unknown, infer T> ? T : never;

  const ProductSchema = type({ name: 'string', price: 'number' });
  expectTypeOf<
    ColumnInputType<ReturnType<typeof arktypeJsonColumn<typeof ProductSchema>>>
  >().toEqualTypeOf<{ name: string; price: number }>();
});

test('arktypeJsonDescriptor: factory(params) returns erased ArktypeJsonCodecClass<unknown>', () => {
  const factory = arktypeJsonDescriptor.factory({ expression: 'string', jsonIr: {} });
  expectTypeOf(factory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => ArktypeJsonCodecClass<unknown>
  >();
});

test('ArktypeJsonCodecClass accepts raw JSON text or pre-parsed JsonValue wire', () => {
  expectTypeOf<ArktypeJsonCodecClass<unknown>>().toExtend<
    Codec<'arktype/json@1', readonly ['equality'], string | JsonValue, unknown>
  >();
});

arktypeJsonColumn satisfies ColumnHelperFor<ArktypeJsonDescriptor>;

test('coarse satisfies catches wrong typeParams shape on arktypeJsonColumn', () => {
  const brokenHelper = (_schema: unknown) =>
    column(
      (_ctx: CodecInstanceContext) =>
        new (class FakeCodec {
          readonly id = 'arktype/json@1' as const;
          toWire(_v: unknown, _c: unknown): Promise<string> {
            return Promise.resolve('');
          }
          fromWire(_w: string, _c: unknown): Promise<unknown> {
            return Promise.resolve(undefined);
          }
          readonly dataType = pgJsonb;
          toDataTypeValue(_v: unknown): DataTypeValue {
            return pgJsonb.fromContract(null, {});
          }
          fromDataTypeValue(_value: DataTypeValue): unknown {
            return undefined;
          }
        })(),
      arktypeJsonDescriptor.codecId,
      { wrongKey: 'oops' },
    );
  // @ts-expect-error -- typeParams shape doesn't satisfy ArktypeJsonTypeParams (missing `expression`/`jsonIr`)
  brokenHelper satisfies ColumnHelperFor<ArktypeJsonDescriptor>;
});

test('arktypeJsonColumn: result is ColumnSpec with typed codecFactory', () => {
  const ProductSchema = type({ name: 'string', price: 'number' });
  const col = arktypeJsonColumn(ProductSchema);
  expectTypeOf(col).toExtend<
    ColumnSpec<ArktypeJsonCodecClass<{ name: string; price: number }>, ArktypeJsonTypeParams>
  >();
});
