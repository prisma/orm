import type { ExtensionPackRef } from '@internal/framework-components/components';
import type { ExtractMongoCodecTypes } from '@internal/mongo-contract';
import type { MongoContractResult } from '@internal/mongo-contract-ts/contract-builder';
import type { CodecTypes } from '@internal/target-mongo/codec-types';
import { expectTypeOf, test } from 'vitest';

// Without an extension pack the builder types every codec entry as `never`, so the contract here declares one.
type ExtensionWithOneCodec = ExtensionPackRef<'mongo', 'mongo'> & {
  readonly __codecTypes?: {
    readonly 'probe/text@1': { readonly input: string; readonly output: string };
  };
};

type TypeScriptContractCodecTypes = ExtractMongoCodecTypes<
  MongoContractResult<{ readonly extensions: { readonly probe: ExtensionWithOneCodec } }>
>;

test('the MongoDB builder`s copy of the codec types, which a TypeScript contract carries, equals the target`s CodecTypes', () => {
  expectTypeOf<Omit<TypeScriptContractCodecTypes, 'probe/text@1'>>().toEqualTypeOf<CodecTypes>();
});
