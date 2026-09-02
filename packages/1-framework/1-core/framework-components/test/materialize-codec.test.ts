import type { JsonValue } from '@internal/contract/types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { test } from 'vitest';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  type CodecDescriptor,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type CodecRef,
  type CodecTrait,
  materializeCodec,
  voidParamsSchema,
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
  override readonly codecId = 'demo/int4@1' as const;
  override readonly traits: readonly CodecTrait[] = ['equality'];
  override readonly targetTypes: readonly string[] = ['int4'];
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
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

function descriptorFor(ref: CodecRef): AnyCodecDescriptor {
  if (ref.codecId === int4FixtureDescriptor.codecId) return int4FixtureDescriptor;
  if (ref.codecId === vectorFixtureDescriptor.codecId) return vectorFixtureDescriptor;
  throw new Error(`no fixture descriptor for ${ref.codecId}`);
}

test('materializeCodec resolves a non-parameterized codec whose id reads the descriptor codecId', ({
  expect,
}) => {
  const ref: CodecRef = { codecId: 'demo/int4@1' };
  const codec = materializeCodec(descriptorFor(ref), ref, stubCtx);
  expect(codec.id).toBe('demo/int4@1');
});

test('materializeCodec resolves a parameterized codec whose id reads the descriptor codecId', ({
  expect,
}) => {
  const ref: CodecRef = { codecId: 'demo/vector@1', typeParams: { length: 1536 } };
  const codec = materializeCodec(descriptorFor(ref), ref, stubCtx);
  expect(codec.id).toBe('demo/vector@1');
});

test('materializeCodec produces a codec whose encode/decode still run through the descriptor-bound factory', async ({
  expect,
}) => {
  const ref: CodecRef = { codecId: 'demo/vector@1', typeParams: { length: 3 } };
  const codec = materializeCodec(descriptorFor(ref), ref, stubCtx);
  const wire = await codec.encode([1, 2, 3], {});
  expect(wire).toBe('[1,2,3]');
  expect(await codec.decode(wire, {})).toEqual([1, 2, 3]);
});
