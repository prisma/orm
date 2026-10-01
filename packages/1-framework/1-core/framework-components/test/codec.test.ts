/**
 * Framework-components-level runtime tests for the `CodecImpl.id` proxy through `descriptor.codecId`.
 *
 * The class-based codec hierarchy declares `Codec.id` on the abstract `CodecImpl` base as a getter that returns `this.descriptor.codecId`. Type-level assertions don't exercise the getter, so a regression where someone wires `id` to a hardcoded literal or forgets to pass `super(descriptor)` would slip through type checks — these runtime round-trip tests catch that.
 *
 * The proxy is also the load-bearing aliasing mechanism: an alias-style descriptor that overrides `codecId` produces codec instances whose `id` reads the alias's id (per spec § Class hierarchy aliasing). The third test below specifically exercises this regression vector.
 */

import type { JsonValue } from '@internal/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { test } from 'vitest';
import {
  type CodecCallContext,
  type CodecDescriptor,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecTrait,
  dataTypeId,
} from '../src/exports/codec';

class Int4FixtureCodec extends CodecImpl<'demo/int4@1', readonly ['equality'], number, number> {
  async encode(value: number, _ctx: CodecCallContext): Promise<number> {
    return value;
  }
  async decode(wire: number, _ctx: CodecCallContext): Promise<number> {
    return wire;
  }
  encodeJson(value: number): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number {
    return json as number;
  }
}

class Int4FixtureDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = dataTypeId('demo/int4');
  override readonly codecId = 'demo/int4@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly targetTypes: readonly string[] = ['int4'];
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => Int4FixtureCodec {
    return () => new Int4FixtureCodec(this);
  }
}

const int4FixtureDescriptor = new Int4FixtureDescriptor();

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
    super(descriptor);
  }
  async encode(value: number[], _ctx: CodecCallContext): Promise<string> {
    return `[${value.join(',')}]`;
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return wire.slice(1, -1).split(',').map(Number);
  }
  encodeJson(value: number[]): JsonValue {
    return value;
  }
  decodeJson(json: JsonValue): number[] {
    return json as number[];
  }
}

class VectorFixtureDescriptor extends CodecDescriptorImpl<VectorParams> {
  override readonly dataType = dataTypeId('demo/vector');
  override readonly codecId = 'demo/vector@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly targetTypes: readonly string[] = ['vector'];
  override readonly paramsSchema = vectorFixtureParamsSchema;
  override factory<N extends number>(params: {
    readonly length: N;
  }): (ctx: CodecInstanceContext) => VectorFixtureCodec<N> {
    return () => new VectorFixtureCodec<N>(this, params.length);
  }
}

const vectorFixtureDescriptor = new VectorFixtureDescriptor();

const stubCtx = {} as CodecInstanceContext;

test('CodecImpl.id proxies through descriptor.codecId (non-parameterized)', ({ expect }) => {
  const codec = int4FixtureDescriptor.factory()(stubCtx);
  expect(codec.id).toBe(int4FixtureDescriptor.codecId);
  expect(codec.id).toBe('demo/int4@1');
});

test('CodecImpl.id proxies through descriptor.codecId (parameterized)', ({ expect }) => {
  const codec = vectorFixtureDescriptor.factory({ length: 1536 })(stubCtx);
  expect(codec.id).toBe(vectorFixtureDescriptor.codecId);
  expect(codec.id).toBe('demo/vector@1');
});

test('alias descriptor produces codec whose id reads the alias codecId', ({ expect }) => {
  // Spec § Class hierarchy aliasing: an alias descriptor instantiates the same concrete codec class (`Int4FixtureCodec`) but passes itself as the descriptor reference. `CodecImpl.id` proxies through `this.descriptor.codecId`, so the runtime id reads the alias's id even though the codec class hardcodes `'demo/int4@1'` in its type-level `Id` parameter. This test locks that regression vector — a future change that locked `id` to the codec class's `Id` type literal would silently break aliasing.
  //
  // The alias extends `CodecDescriptorImpl<void>` directly (not `Int4FixtureDescriptor`) because `Int4FixtureDescriptor.codecId` is narrowed to the literal `'demo/int4@1'`; subclasses can't override it with a different literal under TypeScript's structural overrides.
  class AliasedInt4Descriptor extends CodecDescriptorImpl<void> {
    override readonly dataType = dataTypeId('demo/aliased-int');
    override readonly codecId = 'demo/aliased-int@1' as const;
    override readonly traits: readonly CodecTrait[] = ['equality'];
    override readonly targetTypes: readonly string[] = ['int4'];
    override readonly paramsSchema = undefined;
    override factory(): (ctx: CodecInstanceContext) => Int4FixtureCodec {
      return () => new Int4FixtureCodec(this);
    }
  }
  const aliased = new AliasedInt4Descriptor();
  const codec = aliased.factory()(stubCtx);
  expect(codec.id).toBe('demo/aliased-int@1');
  expect(codec.id).not.toBe(int4FixtureDescriptor.codecId);
});
