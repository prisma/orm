import {
  type AnyCodecDescriptor,
  type DataTypeValue,
  dataType,
  readJsonString,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoCodecDescriptor } from '../src/codec-descriptor';
import { assembleMongoCodecRegistry } from '../src/codec-registry';
import { mongoCodec } from '../src/codecs';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

function textCodec(codecId: string) {
  return mongoCodec({
    typeId: codecId,
    fromWire: (wire: string) => wire,
    toWire: (value: string) => value,
    dataType: textType,
    fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
  });
}

function contributor(id: string, ...codecIds: readonly string[]) {
  return {
    id,
    types: {
      codecTypes: {
        codecDescriptors: codecIds.map((codecId) =>
          mongoCodecDescriptor(textCodec(codecId), { traits: ['equality'] }),
        ),
      },
    },
  };
}

describe('assembleMongoCodecRegistry', () => {
  it('holds the codec of every descriptor every contributor declares', () => {
    const registry = assembleMongoCodecRegistry([
      contributor('target', 'test/target@1'),
      { id: 'adapter' },
      contributor('extension', 'test/extension@1'),
    ]);
    expect([...registry].map((codec) => codec.id)).toEqual(['test/target@1', 'test/extension@1']);
  });

  it('holds the codec instance the descriptor was built from', () => {
    const codec = textCodec('test/text@1');
    const registry = assembleMongoCodecRegistry([
      {
        id: 'extension',
        types: { codecTypes: { codecDescriptors: [mongoCodecDescriptor(codec, { traits: [] })] } },
      },
    ]);
    expect(registry.get('test/text@1')).toBe(codec);
  });

  it('throws RUNTIME.DUPLICATE_CODEC naming both contributors', () => {
    expect(() =>
      assembleMongoCodecRegistry([
        contributor('adapter', 'test/text@1'),
        contributor('extension', 'test/text@1'),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DUPLICATE_CODEC',
        message:
          "Duplicate Mongo codec id 'test/text@1' contributed by 'extension' (already registered by 'adapter').",
        details: { codecId: 'test/text@1', existingOwner: 'adapter', incomingOwner: 'extension' },
      }),
    );
  });
});

describe('mongoCodecDescriptor', () => {
  it('describes the codec with its id, data type and traits', () => {
    const descriptor = mongoCodecDescriptor(textCodec('test/text@1'), { traits: ['equality'] });
    expect(descriptor).toMatchObject({
      codecId: 'test/text@1',
      dataType: 'test/text',
      traits: ['equality'],
      isParameterized: false,
    });
  });

  it('builds the codec for parameters with withParams, and the shared codec without them', () => {
    const shared = textCodec('test/text@1');
    const forParams = textCodec('test/text@1');
    const descriptor: AnyCodecDescriptor = mongoCodecDescriptor(shared, {
      traits: [],
      withParams: () => forParams,
    });
    expect(descriptor.factory(undefined)({ name: 'test/text@1' })).toBe(shared);
    expect(descriptor.factory({ length: 3 })({ name: 'test/text@1' })).toBe(forParams);
  });
});
