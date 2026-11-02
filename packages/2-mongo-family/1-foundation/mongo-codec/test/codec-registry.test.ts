import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { composeMongoCodecRegistry, newMongoCodecRegistry } from '../src/codec-registry';
import { mongoCodec } from '../src/codecs';

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

function contributor(id: string, ...codecIds: readonly string[]) {
  return {
    id,
    codecs: () => {
      const registry = newMongoCodecRegistry();
      for (const codecId of codecIds) {
        registry.register(
          mongoCodec({
            typeId: codecId,
            fromWire: (wire: string) => wire,
            toWire: (value: string) => value,
            dataType: textType,
            fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
          }),
        );
      }
      return registry;
    },
  };
}

describe('composeMongoCodecRegistry', () => {
  it('holds the codecs of every contributor', () => {
    const registry = composeMongoCodecRegistry([
      contributor('target', 'test/target@1'),
      contributor('adapter', 'test/adapter@1'),
      contributor('extension', 'test/extension@1'),
    ]);
    expect([...registry].map((codec) => codec.id)).toEqual([
      'test/target@1',
      'test/adapter@1',
      'test/extension@1',
    ]);
  });

  it('throws RUNTIME.DUPLICATE_CODEC naming both contributors', () => {
    expect(() =>
      composeMongoCodecRegistry([
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
