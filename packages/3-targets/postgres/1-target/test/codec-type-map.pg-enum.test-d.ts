/**
 * `pg/enum@1` must be a key of the public `CodecTypes` map
 * (`ExtractedCodecTypes` in `codec-type-map.ts`), exactly like every other
 * registered Postgres codec. Without this, the query-builder's
 * `CodecExpression`/`CodecValue` machinery — which resolves a raw bound value
 * via `CT[CodecId]['input']` — sees `pg/enum@1` as an unknown key and
 * resolves to `never`, rejecting every string literal a caller could pass to
 * `fns.eq(f.<enumColumn>, value)`. `pgEnumDescriptor` was already registered
 * for runtime codec resolution (`codecDescriptors` in `../src/core/codecs.ts`)
 * but was missing from `codecDescriptorMap`, the map `ExtractedCodecTypes`
 * derives from — a plain omission, not a design gap.
 */

import { expectTypeOf, test } from 'vitest';
import type { ExtractedCodecTypes } from '../src/core/codec-type-map';

test('pg/enum@1 is a key of ExtractedCodecTypes, with string input/output', () => {
  expectTypeOf<keyof ExtractedCodecTypes>().extract<'pg/enum@1'>().not.toBeNever();
  expectTypeOf<ExtractedCodecTypes['pg/enum@1']['input']>().toEqualTypeOf<string>();
  expectTypeOf<ExtractedCodecTypes['pg/enum@1']['output']>().toEqualTypeOf<string>();
});
