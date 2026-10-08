/**
 * Framework-level type tests for the codec abstract class hierarchy + `column()` packager + `ColumnHelperFor<D>` shapes.
 *
 * Uses inline fixture descriptors so the test is framework-internal (no cross-package deps). Negative tests assert the variance discipline: literal preservation through per-codec helpers' direct calls; satisfies shape catches typeParams-shape and codec-wiring mistakes.
 *
 * Refs: TML-2357.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expectTypeOf, test } from 'vitest';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecCallContext,
  type CodecDescriptor,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecTrait,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  type ColumnSpec,
  column,
  type DataTypeValue,
  dataType,
} from '../src/exports/codec';

const int4Type = dataType('demo/int4', { read: (json) => json });
const vectorType = dataType('demo/vector', { read: (json) => json });

class Int4FixtureCodec extends CodecImpl<'demo/int4@1', readonly ['equality'], number, number> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async fromWire(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  toDataTypeValue(value: number): DataTypeValue {
    return this.dataTypeValueOf(value);
  }
  fromDataTypeValue(value: DataTypeValue): number {
    return value.value as number;
  }
}

class Int4FixtureDescriptor extends CodecDescriptorImpl<void> implements CodecDescriptor<void> {
  override readonly dataType = int4Type.id;
  override readonly codecId = 'demo/int4@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => Int4FixtureCodec {
    return () => new Int4FixtureCodec(this, int4Type);
  }
}

const int4FixtureDescriptor = new Int4FixtureDescriptor();

const int4Fixture = () =>
  column(int4FixtureDescriptor.factory(), int4FixtureDescriptor.codecId, undefined);

int4Fixture satisfies ColumnHelperFor<Int4FixtureDescriptor>;
int4Fixture satisfies ColumnHelperForStrict<Int4FixtureDescriptor>;

type VectorParams = { readonly length: number };
const vectorFixtureParamsSchema: StandardSchemaV1<VectorParams> = {
  '~standard': {
    version: 1,
    vendor: 'demo',
    validate: (input) => ({ value: input as VectorParams }),
  },
};

class VectorFixtureCodec<N extends number> extends CodecImpl<
  'demo/vector@1',
  readonly ['equality'],
  string,
  number[]
> {
  constructor(
    descriptor: CodecDescriptor<VectorParams>,
    public readonly dimension: N,
  ) {
    super(descriptor, vectorType);
  }
  async toWire(value: number[], _ctx: CodecCallContext): Promise<string> {
    return `[${value.join(',')}]`;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return wire.slice(1, -1).split(',').map(Number);
  }
  toDataTypeValue(value: number[]): DataTypeValue {
    return this.dataTypeValueOf(value);
  }
  fromDataTypeValue(value: DataTypeValue): number[] {
    return value.value as number[];
  }
}

class VectorFixtureDescriptor
  extends CodecDescriptorImpl<VectorParams>
  implements CodecDescriptor<VectorParams>
{
  override readonly dataType = vectorType.id;
  override readonly codecId = 'demo/vector@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly paramsSchema = vectorFixtureParamsSchema;
  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorFixtureCodec<N> {
    return () => new VectorFixtureCodec<N>(this, params.length);
  }
}

const vectorFixtureDescriptor = new VectorFixtureDescriptor();

const vectorFixture = <N extends number>(length: N) =>
  column(vectorFixtureDescriptor.factory({ length }), vectorFixtureDescriptor.codecId, { length });

vectorFixture satisfies ColumnHelperFor<VectorFixtureDescriptor>;
vectorFixture satisfies ColumnHelperForStrict<VectorFixtureDescriptor>;

test('descriptor factory call preserves method-level generic literal', () => {
  const factory = vectorFixtureDescriptor.factory({ length: 1536 });
  expectTypeOf(factory).toEqualTypeOf<(ctx: CodecInstanceContext) => VectorFixtureCodec<1536>>();
});

test('per-codec helper preserves literal through column packager', () => {
  const col = vectorFixture(1536);
  expectTypeOf(col.codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => VectorFixtureCodec<1536>
  >();
  expectTypeOf(col.typeParams).toEqualTypeOf<{ length: 1536 }>();
});

test('non-parameterized helper packages void typeParams', () => {
  const col = int4Fixture();
  expectTypeOf(col.codecFactory).toEqualTypeOf<(ctx: CodecInstanceContext) => Int4FixtureCodec>();
  expectTypeOf(col.typeParams).toEqualTypeOf<undefined>();
});

test('ResolvedCodec extracts the typed codec from a column spec', () => {
  type ResolvedCodec<C> =
    C extends ColumnSpec<infer R, never>
      ? R
      : C extends { codecFactory: (ctx: CodecInstanceContext) => infer R }
        ? R
        : never;

  type EmbeddingResolved = ResolvedCodec<ReturnType<typeof vectorFixture<1536>>>;
  expectTypeOf<EmbeddingResolved>().toEqualTypeOf<VectorFixtureCodec<1536>>();
});

test('ColumnInputType extracts the codec TInput', () => {
  type ResolvedCodec<C> = C extends { codecFactory: (ctx: CodecInstanceContext) => infer R }
    ? R
    : never;
  type ColumnInputType<C> =
    ResolvedCodec<C> extends Codec<string, readonly CodecTrait[], unknown, infer T> ? T : never;

  expectTypeOf<ColumnInputType<ReturnType<typeof vectorFixture<1536>>>>().toEqualTypeOf<number[]>();
  expectTypeOf<ColumnInputType<ReturnType<typeof int4Fixture>>>().toEqualTypeOf<number>();
});

test('coarse satisfies catches wrong typeParams shape', () => {
  const brokenTypeParamsHelper = <N extends number>(length: N) =>
    column(vectorFixtureDescriptor.factory({ length }), vectorFixtureDescriptor.codecId, {
      wrongKey: length,
    });
  // @ts-expect-error -- typeParams shape doesn't satisfy ColumnHelperFor<VectorFixtureDescriptor> (missing `length`)
  brokenTypeParamsHelper satisfies ColumnHelperFor<VectorFixtureDescriptor>;
  // @ts-expect-error -- strict shape catches the same mismatch
  brokenTypeParamsHelper satisfies ColumnHelperForStrict<VectorFixtureDescriptor>;
});

test('strict satisfies catches wrong codec wired in', () => {
  // A helper that wires the int4 fixture's factory into VectorFixtureDescriptor's codec id slot. Coarse satisfies passes (typeParams shape is correct); strict satisfies fails because the codec types differ.
  const wrongCodecHelper = <N extends number>(length: N) =>
    column(int4FixtureDescriptor.factory(), vectorFixtureDescriptor.codecId, { length });
  wrongCodecHelper satisfies ColumnHelperFor<VectorFixtureDescriptor>;
  // @ts-expect-error -- codec is Int4FixtureCodec, not VectorFixtureCodec<number>
  wrongCodecHelper satisfies ColumnHelperForStrict<VectorFixtureDescriptor>;
});

test('column packs the codec id and parameters, and no database type name', () => {
  const col = vectorFixture(1536);
  expectTypeOf(col).not.toHaveProperty('nativeType');
  if (col.codecId !== 'demo/vector@1' || col.typeParams.length !== 1536 || 'nativeType' in col) {
    throw new Error(`unexpected column spec: ${JSON.stringify(col)}`);
  }
});

test('AnyCodecDescriptor stores parameterized + non-parameterized descriptors without casts', () => {
  // Heterogeneous storage uses `AnyCodecDescriptor` (variance-erased `CodecDescriptor<any>`). `CodecDescriptor<P>` is invariant in `P`, so concrete subclasses are NOT assignable to `CodecDescriptor<unknown>` — an `as` cast at the storage boundary would mask the variance violation. The `AnyCodecDescriptor` form removes the cast and the assignments typecheck directly because `CodecDescriptorImpl<TParams>` is structurally compatible with `CodecDescriptor<any>` regardless of `TParams`.
  const reg = new Map<string, AnyCodecDescriptor>();
  reg.set(int4FixtureDescriptor.codecId, int4FixtureDescriptor);
  reg.set(vectorFixtureDescriptor.codecId, vectorFixtureDescriptor);
  expectTypeOf<typeof reg>().toMatchTypeOf<Map<string, AnyCodecDescriptor>>();
});
