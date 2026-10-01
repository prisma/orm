/**
 * Constructive type tests at the descriptor round-trip layer (TML-2357).
 *
 * The descriptor surface is the canonical path from a `CodecDescriptor<P>` instance to its resolved `Codec` shape. These tests pin that round-trip end-to-end at the SQL base codec layer: given a concrete descriptor, the resolved codec exactly equals `Codec<Id, Traits, Wire, Input>` with the literal Id, the readonly trait tuple preserved, and Wire / Input fixed.
 *
 * Coverage:
 * - one non-parameterized SQL base codec (`sqlInt`)
 * - one parameterized SQL base codec (`sqlVarchar`)
 * - one inline "extension" descriptor exercising a custom Wire/Input pair via {@link CodecDescriptorImpl}; this stands in for the extension-codec axis covered concretely by `pgVector` in the per-target descriptor flow tests (T0.D.2).
 *
 * Negative coverage uses `// @ts-expect-error` so a regression in the round-trip mapping (e.g. trait widening, Wire/Input drift, codec id mismatch) breaks the test type-check rather than passing silently.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecTrait,
  dataTypeId,
} from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type {
  SqlIntCodec,
  SqlVarcharCodec,
  sqlIntDescriptor,
  sqlVarcharDescriptor,
} from '../src/ast/sql-codecs';

type ResolvedCodec<D> = D extends {
  factory: (...args: never[]) => (ctx: CodecInstanceContext) => infer R;
}
  ? R
  : never;

test('non-parameterized SQL base codec — sqlInt round-trips to typed Codec', () => {
  type Resolved = ResolvedCodec<typeof sqlIntDescriptor>;
  expectTypeOf<Resolved>().toEqualTypeOf<SqlIntCodec>();
  expectTypeOf<Resolved>().toExtend<
    Codec<'sql/int@1', readonly ['equality', 'order', 'numeric'], number, number>
  >();
});

test('parameterized SQL base codec — sqlVarchar round-trips to typed Codec', () => {
  type Resolved = ResolvedCodec<typeof sqlVarcharDescriptor>;
  expectTypeOf<Resolved>().toEqualTypeOf<SqlVarcharCodec>();
  expectTypeOf<Resolved>().toExtend<
    Codec<'sql/varchar@1', readonly ['equality', 'order', 'textual'], string, string>
  >();
});

class TestVectorCodec extends CodecImpl<'test/vector@1', readonly ['equality'], string, number[]> {
  async encode(value: number[], _ctx: CodecCallContext): Promise<string> {
    return `[${value.join(',')}]`;
  }
  async decode(_wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return [];
  }
  encodeJson(value: number[]): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number[] {
    return json as number[];
  }
}

class TestVectorDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = dataTypeId('test/vector');
  override readonly codecId = 'test/vector@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => TestVectorCodec {
    return () => new TestVectorCodec(this);
  }
}

const testVectorDescriptor = new TestVectorDescriptor();

test('extension-style descriptor round-trips with custom Wire/Input', () => {
  type Resolved = ResolvedCodec<typeof testVectorDescriptor>;
  expectTypeOf<Resolved>().toEqualTypeOf<TestVectorCodec>();
  expectTypeOf<Resolved>().toExtend<
    Codec<'test/vector@1', readonly ['equality'], string, number[]>
  >();
});

test('wrong codec id breaks the round-trip equality', () => {
  type Resolved = ResolvedCodec<typeof sqlIntDescriptor>;
  expectTypeOf<Resolved['id']>().toEqualTypeOf<'sql/int@1'>();
  // @ts-expect-error -- resolved codec id is `sql/int@1`, not `sql/varchar@1`
  expectTypeOf<Resolved['id']>().toEqualTypeOf<'sql/varchar@1'>();
});

test('wrong wire type breaks the round-trip equality', () => {
  type ExtractWire<C> =
    C extends Codec<string, readonly CodecTrait[], infer W, unknown> ? W : never;
  type ResolvedWire = ExtractWire<ResolvedCodec<typeof sqlIntDescriptor>>;
  expectTypeOf<ResolvedWire>().toEqualTypeOf<number>();
  // @ts-expect-error -- sqlInt wire is `number`, not `string`
  expectTypeOf<ResolvedWire>().toEqualTypeOf<string>();
});

test('widened trait union breaks the round-trip equality', () => {
  // Read traits off the descriptor — the codec instance carries them on an optional phantom slot which is not always preserved by inference.
  type DescTraits = (typeof sqlIntDescriptor)['traits'];
  expectTypeOf<DescTraits>().toEqualTypeOf<readonly ['equality', 'order', 'numeric']>();
  // @ts-expect-error -- sqlInt traits include `numeric`, not just `['equality']`
  expectTypeOf<DescTraits>().toEqualTypeOf<readonly ['equality']>();
});
