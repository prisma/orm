import { expectTypeOf, test } from 'vitest';
import type { mongoBsonCodec } from '../src/core/codecs';
import type { CodecTypes } from '../src/exports/codec-types';

type BsonTypes = CodecTypes['mongo/bson@1'];

test('the Bson codec decodes to the CodecTypes output type', () => {
  expectTypeOf<Awaited<ReturnType<typeof mongoBsonCodec.decode>>>().toEqualTypeOf<
    BsonTypes['output']
  >();
});

test('the Bson codec encodes the CodecTypes input type', () => {
  expectTypeOf<Parameters<typeof mongoBsonCodec.encode>[0]>().toEqualTypeOf<BsonTypes['input']>();
});
