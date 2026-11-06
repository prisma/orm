import { expectTypeOf, test } from 'vitest';
import type { mongoBsonCodec } from '../src/core/codecs';
import type { CodecTypes } from '../src/exports/codec-types';

type BsonTypes = CodecTypes['mongo/bson@1'];

test('the Bson codec reads wire values as the CodecTypes output type', () => {
  expectTypeOf<Awaited<ReturnType<typeof mongoBsonCodec.fromWire>>>().toEqualTypeOf<
    BsonTypes['output']
  >();
});

test('the Bson codec writes the CodecTypes input type to the wire', () => {
  expectTypeOf<Parameters<typeof mongoBsonCodec.toWire>[0]>().toEqualTypeOf<BsonTypes['input']>();
});
