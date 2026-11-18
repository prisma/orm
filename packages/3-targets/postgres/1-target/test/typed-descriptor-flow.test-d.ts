/**
 * Constructive type tests for the postgres per-target descriptor record layer.
 *
 * Coverage:
 * - trait literals survive on each descriptor class — {@link DescriptorCodecTraits} reads `traits` directly off the descriptor, so the literal tuple shape (`readonly ['equality', 'order', 'numeric']`) is preserved rather than widened to `readonly CodecTrait[]`;
 * - the resolved `CodecTypes` projection contains the codec-id keys consumers reference at the no-emit authoring chain.
 *
 * Negative coverage (`// @ts-expect-error`) proves that a regression in trait preservation or a missing codec id breaks the test compile.
 */

import type { CodecTrait } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import {
  type PgInt4Descriptor,
  type PgNumericDescriptor,
  pgInt4Descriptor,
  pgNumericDescriptor,
} from '../src/core/codecs';
import type { CodecTypes } from '../src/exports/codec-types';

test('pgInt4Descriptor.traits is a readonly literal tuple, not widened', () => {
  type Traits = PgInt4Descriptor['traits'];
  expectTypeOf<Traits>().toEqualTypeOf<readonly ['equality', 'order', 'numeric']>();
  expectTypeOf<Traits[number]>().toExtend<CodecTrait>();
});

test('pgNumericDescriptor.traits preserves the same literal tuple', () => {
  type Traits = PgNumericDescriptor['traits'];
  expectTypeOf<Traits>().toEqualTypeOf<readonly ['equality', 'order', 'numeric']>();
});

test('pgInt4Descriptor.codecId is the literal `pg/int4@1`', () => {
  expectTypeOf(pgInt4Descriptor.codecId).toEqualTypeOf<'pg/int4@1'>();
});

test('pgNumericDescriptor.codecId is the literal `pg/numeric@1`', () => {
  expectTypeOf(pgNumericDescriptor.codecId).toEqualTypeOf<'pg/numeric@1'>();
});

test('CodecTypes is keyed by codec id and exposes input/output/traits', () => {
  expectTypeOf<CodecTypes['pg/int4@1']>().toExtend<{
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  }>();

  expectTypeOf<CodecTypes['pg/varchar@1']>().toExtend<{
    readonly input: string;
    readonly output: string;
  }>();
});

test('widened trait shape on pgInt4 fails the equality check', () => {
  type Traits = PgInt4Descriptor['traits'];
  // @ts-expect-error -- traits literal tuple is preserved, not widened to CodecTrait[]
  expectTypeOf<Traits>().toEqualTypeOf<readonly CodecTrait[]>();
});

test('non-existent codec id is absent from CodecTypes', () => {
  // @ts-expect-error -- `pg/nonexistent@1` is not a registered codec id
  type _Missing = CodecTypes['pg/nonexistent@1'];
});
