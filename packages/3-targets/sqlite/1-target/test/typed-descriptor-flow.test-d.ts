/**
 * Constructive type tests for the sqlite per-target descriptor record layer (TML-2357). Mirrors the postgres test (`packages/3-targets/postgres/1-target/test/typed-descriptor-flow.test-d.ts`).
 */

import type { CodecTrait } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import {
  type SqliteDatetimeDescriptor,
  type SqliteIntegerDescriptor,
  sqliteDatetimeDescriptor,
  sqliteIntegerDescriptor,
} from '../src/core/codecs';
import type { CodecTypes } from '../src/exports/codec-types';

test('sqliteIntegerDescriptor.traits is a readonly literal tuple, not widened', () => {
  type Traits = SqliteIntegerDescriptor['traits'];
  expectTypeOf<Traits>().toEqualTypeOf<readonly ['equality', 'order', 'numeric']>();
  expectTypeOf<Traits[number]>().toExtend<CodecTrait>();
});

test('sqliteDatetimeDescriptor.traits preserves its literal tuple', () => {
  type Traits = SqliteDatetimeDescriptor['traits'];
  expectTypeOf<Traits>().toEqualTypeOf<readonly ['equality', 'order']>();
});

test('sqliteIntegerDescriptor.codecId is the literal `sqlite/integer@1`', () => {
  expectTypeOf(sqliteIntegerDescriptor.codecId).toEqualTypeOf<'sqlite/integer@1'>();
});

test('sqliteDatetimeDescriptor.codecId is the literal `sqlite/datetime@1`', () => {
  expectTypeOf(sqliteDatetimeDescriptor.codecId).toEqualTypeOf<'sqlite/datetime@1'>();
});

test('CodecTypes is keyed by codec id and exposes input/output/traits', () => {
  expectTypeOf<CodecTypes['sqlite/integer@1']>().toExtend<{
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  }>();

  expectTypeOf<CodecTypes['sqlite/datetime@1']>().toExtend<{
    readonly input: Date;
  }>();
});

test('non-existent codec id is absent from CodecTypes', () => {
  // @ts-expect-error -- `sqlite/nonexistent@1` is not a registered codec id
  type _Missing = CodecTypes['sqlite/nonexistent@1'];
});
