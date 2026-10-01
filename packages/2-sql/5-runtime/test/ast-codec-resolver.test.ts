import type { JsonValue } from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  CodecDescriptor,
  CodecRef,
} from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import type { Codec, SqlCodecInstanceContext } from '@internal/sql-relational-core/ast';
import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import { describe, expect, it, vi } from 'vitest';
import { createAstCodecResolver } from '../src/codecs/ast-codec-resolver';
import type { RuntimeParameterizedCodecDescriptor } from '../src/sql-context';
import { defineTestCodec } from './test-codec';

function instanceContextFactory(): SqlCodecInstanceContext {
  return { name: '<ast-supplied>', usedAt: [] };
}

interface VectorParams {
  readonly length: number;
  readonly [key: string]: JsonValue | undefined;
}

function makeVectorDescriptor(): RuntimeParameterizedCodecDescriptor<VectorParams> {
  return {
    codecId: 'pg/vector@1',
    dataType: dataTypeId('pg/vector'),
    traits: ['equality'],
    targetTypes: ['vector'],
    paramsSchema: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => {
          const v = value as VectorParams | undefined;
          if (!v || typeof v.length !== 'number' || v.length <= 0) {
            return {
              issues: [{ message: 'length must be a positive number' }],
            };
          }
          return { value: v };
        },
      },
    },
    isParameterized: true,
    factory: (params) => (ctx) => {
      const codec = defineTestCodec({
        typeId: 'pg/vector@1',
        encode: (v: number[]) => v,
        decode: (w: number[]) => w,
      });
      return Object.assign({}, codec, { meta: { length: params.length, name: ctx.name } }) as Codec;
    },
  };
}

function makeScalarDescriptor(): CodecDescriptor {
  return {
    codecId: 'test/scalar@1',
    dataType: dataTypeId('test/scalar'),
    traits: [],
    targetTypes: ['scalar'],
    paramsSchema: undefined,
    isParameterized: false,
    factory: () => () =>
      defineTestCodec({
        typeId: 'test/scalar@1',
        encode: (v: string) => v,
        decode: (w: string) => w,
      }),
  };
}

function buildRegistry(extras: ReadonlyArray<AnyCodecDescriptor> = []) {
  return buildCodecDescriptorRegistry([
    makeVectorDescriptor() as AnyCodecDescriptor,
    makeScalarDescriptor(),
    ...extras,
  ]);
}

describe('createAstCodecResolver', () => {
  it('returns the same Codec reference on cache hit', () => {
    const resolver = createAstCodecResolver(buildRegistry(), instanceContextFactory);
    const ref: CodecRef = { codecId: 'pg/vector@1', typeParams: { length: 1536 } };

    const first = resolver.forCodecRef(ref);
    const second = resolver.forCodecRef(ref);

    expect(first).toBe(second);
  });

  it('keys cache by canonicalized typeParams so object key order does not matter', () => {
    const resolver = createAstCodecResolver(buildRegistry(), instanceContextFactory);
    const refA: CodecRef = {
      codecId: 'pg/vector@1',
      typeParams: { length: 768, normalized: true } as JsonValue,
    };
    const refB: CodecRef = {
      codecId: 'pg/vector@1',
      typeParams: { normalized: true, length: 768 } as JsonValue,
    };

    expect(resolver.forCodecRef(refA)).toBe(resolver.forCodecRef(refB));
  });

  it('shares one Codec instance across calls for non-parameterized codec ids', () => {
    const resolver = createAstCodecResolver(buildRegistry(), instanceContextFactory);
    const ref: CodecRef = { codecId: 'test/scalar@1' };

    const first = resolver.forCodecRef(ref);
    const second = resolver.forCodecRef(ref);

    expect(first).toBe(second);
    expect(first?.id).toBe('test/scalar@1');
  });

  it('validates typeParams via the descriptor paramsSchema on cache miss', () => {
    const descriptor = makeVectorDescriptor();
    const validate = vi.spyOn(descriptor.paramsSchema['~standard'], 'validate');
    const resolver = createAstCodecResolver(
      buildCodecDescriptorRegistry([descriptor as AnyCodecDescriptor, makeScalarDescriptor()]),
      instanceContextFactory,
    );

    resolver.forCodecRef({ codecId: 'pg/vector@1', typeParams: { length: 1024 } });
    resolver.forCodecRef({ codecId: 'pg/vector@1', typeParams: { length: 1024 } });

    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('throws RUNTIME.TYPE_PARAMS_INVALID when paramsSchema rejects the input', () => {
    const resolver = createAstCodecResolver(buildRegistry(), instanceContextFactory);

    expect(() =>
      resolver.forCodecRef({ codecId: 'pg/vector@1', typeParams: { length: -1 } }),
    ).toThrow(/TYPE_PARAMS_INVALID|length must be a positive number/);
  });

  it('throws RUNTIME.TYPE_PARAMS_INVALID when paramsSchema returns a Promise (async validator)', () => {
    const asyncDescriptor: CodecDescriptor<VectorParams> = {
      codecId: 'async/vector@1',
      dataType: dataTypeId('async/vector'),
      traits: [],
      targetTypes: ['vector'],
      paramsSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: () => Promise.resolve({ value: { length: 1 } }),
        },
      },
      isParameterized: true,
      factory: (_params) => (_ctx) =>
        defineTestCodec({
          typeId: 'async/vector@1',
          encode: (v: number[]) => v,
          decode: (w: number[]) => w,
        }),
    };
    const resolver = createAstCodecResolver(
      buildCodecDescriptorRegistry([asyncDescriptor as AnyCodecDescriptor]),
      instanceContextFactory,
    );

    expect(() =>
      resolver.forCodecRef({ codecId: 'async/vector@1', typeParams: { length: 1 } }),
    ).toThrow(/TYPE_PARAMS_INVALID|Promise|synchronous/);
  });

  it('throws RUNTIME.CODEC_DESCRIPTOR_MISSING when the codec id is unknown', () => {
    const resolver = createAstCodecResolver(buildRegistry(), instanceContextFactory);

    expect(() => resolver.forCodecRef({ codecId: 'nope/missing@1' })).toThrow(
      /CODEC_DESCRIPTOR_MISSING|nope\/missing@1/,
    );
  });
});
