import { expectTypeOf, test } from 'vitest';
import type { MongoCodecInput } from '../src/contract-types';

type CodecTypes = {
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/objectId@1': { readonly input: string | Uint8Array; readonly output: string };
  readonly 'test/outputOnly@1': { readonly output: number };
};

test('reads the input type of a codec', () => {
  expectTypeOf<MongoCodecInput<CodecTypes, 'mongo/string@1'>>().toEqualTypeOf<string>();
  expectTypeOf<MongoCodecInput<CodecTypes, 'mongo/objectId@1'>>().toEqualTypeOf<
    string | Uint8Array
  >();
});

test('is unknown for a codec that declares no input type', () => {
  expectTypeOf<MongoCodecInput<CodecTypes, 'test/outputOnly@1'>>().toBeUnknown();
});
