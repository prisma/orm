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
  dataTypeId,
  materializeCodec,
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

/**
 * Copies a descriptor the way arktype's default clone does when a config section is validated:
 * same prototype, and every plain object it holds is a new object with the same keys.
 */
function copyLikeArktype<T extends object>(original: T): T {
  const copy = Object.create(Object.getPrototypeOf(original));
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(original))) {
    const value: unknown = descriptor.value;
    const isPlainObject =
      typeof value === 'object' &&
      value !== null &&
      Object.getPrototypeOf(value) === Object.prototype;
    Object.defineProperty(copy, key, {
      ...descriptor,
      value: isPlainObject ? { ...value } : value,
    });
  }
  return copy;
}

test('a codec without params stays non-parameterized when its descriptor is copied', ({
  expect,
}) => {
  expect(copyLikeArktype(int4FixtureDescriptor).isParameterized).toBe(false);
  expect(copyLikeArktype(vectorFixtureDescriptor).isParameterized).toBe(true);
});

test('materializeCodec rejects typeParams for a codec without params', ({ expect }) => {
  const ref: CodecRef = { codecId: 'demo/int4@1', typeParams: { length: 3 } };
  expect(() => materializeCodec(descriptorFor(ref), ref, stubCtx)).toThrow(
    "Invalid typeParams for codec 'demo/int4@1': unexpected typeParams for non-parameterized codec",
  );
});

test('materializeCodec treats empty typeParams as none for a codec without params', ({
  expect,
}) => {
  const ref: CodecRef = { codecId: 'demo/int4@1', typeParams: {} };
  expect(materializeCodec(descriptorFor(ref), ref, stubCtx).id).toBe('demo/int4@1');
});
