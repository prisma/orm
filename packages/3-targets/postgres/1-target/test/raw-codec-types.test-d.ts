import { expectTypeOf, test } from 'vitest';
import type { CodecTypes } from '../src/exports/codec-types';

test('an emitted contract types a raw column unknown, on input and output', () => {
  expectTypeOf<CodecTypes['sql/raw@1']['output']>().toEqualTypeOf<unknown>();
  expectTypeOf<CodecTypes['sql/raw@1']['input']>().toEqualTypeOf<unknown>();
});
