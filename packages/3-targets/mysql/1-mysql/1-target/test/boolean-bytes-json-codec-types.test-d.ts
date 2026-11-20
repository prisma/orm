import type { JsonValue } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes } from '../src/exports/codec-types';

test('a Boolean reads and writes a boolean, Bytes a Uint8Array and Json a JSON value', () => {
  expectTypeOf<CodecTypes['mysql/boolean@1']['output']>().toEqualTypeOf<boolean>();
  expectTypeOf<CodecTypes['mysql/boolean@1']['input']>().toEqualTypeOf<boolean>();
  expectTypeOf<CodecTypes['mysql/longblob@1']['output']>().toEqualTypeOf<Uint8Array>();
  expectTypeOf<CodecTypes['mysql/longblob@1']['input']>().toEqualTypeOf<Uint8Array>();
  expectTypeOf<CodecTypes['mysql/json@1']['output']>().toEqualTypeOf<JsonValue>();
  expectTypeOf<CodecTypes['mysql/json@1']['input']>().toEqualTypeOf<JsonValue>();
});
