import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CodecTypes } from '../src/exports/codec-types';
import { mongoCodecDescriptors } from '../src/exports/codecs';

const traitsByCodec = {
  'mongo/objectId@1': ['equality'],
  'mongo/string@1': ['equality', 'order', 'textual'],
  'mongo/double@1': ['equality', 'order', 'numeric'],
  'mongo/int32@1': ['equality', 'order', 'numeric'],
  'mongo/bool@1': ['equality', 'boolean'],
  'mongo/date@1': ['equality', 'order'],
  'mongo/vector@1': ['equality'],
  'mongo/int64@1': ['equality', 'order', 'numeric'],
  'mongo/int64Number@1': ['equality', 'order', 'numeric'],
  'mongo/decimal128@1': ['equality', 'order', 'numeric'],
  'mongo/binary@1': ['equality'],
  'mongo/json@1': [],
  'mongo/bson@1': [],
} as const;

describe('Mongo CodecTypes traits', () => {
  it('are the traits of each codec descriptor', () => {
    expect(
      Object.fromEntries(mongoCodecDescriptors.map((d) => [d.codecId, [...d.traits]])),
    ).toEqual(traitsByCodec);
    expectTypeOf<{ readonly [K in keyof CodecTypes]: CodecTypes[K]['traits'] }>().toEqualTypeOf<{
      readonly [K in keyof typeof traitsByCodec]: (typeof traitsByCodec)[K][number];
    }>();
  });
});
