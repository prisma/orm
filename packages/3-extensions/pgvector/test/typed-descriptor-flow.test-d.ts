/**
 * Constructive type tests for the pgvector per-extension descriptor record layer (TML-2357). Mirrors the per-target tests in postgres / sqlite.
 */

import type { CodecTrait } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import { type PgVectorDescriptor, pgVectorDescriptor } from '../src/core/codecs';
import type { CodecTypes } from '../src/exports/codec-types';

test('pgVectorDescriptor.traits is the readonly literal tuple', () => {
  type Traits = PgVectorDescriptor['traits'];
  expectTypeOf<Traits>().toEqualTypeOf<readonly ['equality']>();
  expectTypeOf<Traits[number]>().toExtend<CodecTrait>();
});

test('pgVectorDescriptor.codecId is the literal `pg/vector@1`', () => {
  expectTypeOf(pgVectorDescriptor.codecId).toEqualTypeOf<'pg/vector@1'>();
});

test('CodecTypes is keyed by codec id and exposes input/output/traits', () => {
  expectTypeOf<CodecTypes['pg/vector@1']>().toExtend<{
    readonly input: number[];
    readonly output: number[];
    readonly traits: 'equality';
  }>();
});

test('non-existent codec id is absent from CodecTypes', () => {
  // @ts-expect-error -- `pg/nonexistent@1` is not a registered codec id
  type _Missing = CodecTypes['pg/nonexistent@1'];
});
