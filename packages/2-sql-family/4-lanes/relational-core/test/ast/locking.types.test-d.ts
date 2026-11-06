import { expectTypeOf, test } from 'vitest';
import type { LockWaitOptions } from '../../src/ast/locking';

type Neither = { readonly nowait?: never; readonly skipLocked?: never };
type Nowait = { readonly nowait?: true; readonly skipLocked?: never };
type SkipLocked = { readonly skipLocked?: true; readonly nowait?: never };

test('each wait option exists only under its flag', () => {
  expectTypeOf<LockWaitOptions<{ sql: { forUpdate: true } }>>().toEqualTypeOf<Neither>();
  expectTypeOf<LockWaitOptions<{ sql: { lockNowait: true } }>>().toEqualTypeOf<Nowait | Neither>();
  expectTypeOf<LockWaitOptions<{ sql: { lockSkipLocked: true } }>>().toEqualTypeOf<
    SkipLocked | Neither
  >();
  expectTypeOf<
    LockWaitOptions<{ sql: { lockNowait: true; lockSkipLocked: true } }>
  >().toEqualTypeOf<Nowait | SkipLocked | Neither>();
});

test('a flag typed boolean offers neither option', () => {
  expectTypeOf<
    LockWaitOptions<{ sql: { lockNowait: boolean; lockSkipLocked: boolean } }>
  >().toEqualTypeOf<Neither>();
});
