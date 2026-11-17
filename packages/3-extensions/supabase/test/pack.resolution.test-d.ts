/**
 * Smoke test: /pack resolution + typecheck contract (D7).
 *
 * Proves that `supabasePack` (and `supabasePackWith(...)`) satisfies the
 * `ControlExtensionDescriptor<'sql', 'postgres'>` element type that
 * `extensions` in `PrismaConfig` accepts — i.e. the `/pack` export
 * is assignable to the config contract without a type error.
 *
 * This file is intentionally type-level only (no runtime assertions).
 */

import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { expectTypeOf, test } from 'vitest';
import supabasePack, { supabasePackWith } from '../src/exports/pack';

test('supabasePack and supabasePackWith() are ControlExtensionDescriptor<sql, postgres>', () => {
  expectTypeOf(supabasePack).toExtend<ControlExtensionDescriptor<'sql', 'postgres'>>();
  expectTypeOf(supabasePackWith({ contractOverride: {} })).toExtend<
    ControlExtensionDescriptor<'sql', 'postgres'>
  >();
});
