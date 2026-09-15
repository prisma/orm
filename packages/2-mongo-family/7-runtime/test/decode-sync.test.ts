import { mongoCodec } from '@internal/mongo-codec';
import { expect, it } from 'vitest';
import { decodeMongoRow } from '../src/codecs/decoding';

it('decodes nested array leaves synchronously', () => {
  const codec = mongoCodec({
    typeId: 'test/sync@1',
    encode: (value: number) => value,
    decode: (value: number) => value * 10,
  });
  const result = decodeMongoRow(
    { values: [1, null, 2], untouched: true },
    {
      kind: 'document',
      fields: {
        values: {
          kind: 'array',
          nullable: false,
          element: { kind: 'leaf', codecId: codec.id, nullable: true },
        },
      },
    },
    new Map([[codec.id, codec]]),
    'items',
  );
  expect(result).toEqual({ values: [10, null, 20], untouched: true });
});
