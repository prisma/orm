import type { ClientActivity } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import { type ActivityHandle, startActivityOn } from '../src/activity-handle';
import type {
  Runtime,
  RuntimeConnection,
  RuntimeTransaction,
  TransactionContext,
} from '../src/sql-runtime';
import './client-activity-kinds';

test('the public runtime types do not show startActivity or planContentHash', () => {
  expectTypeOf<Runtime>().not.toHaveProperty('startActivity');
  expectTypeOf<Runtime>().not.toHaveProperty('planContentHash');
  expectTypeOf<RuntimeConnection>().not.toHaveProperty('startActivity');
  expectTypeOf<RuntimeConnection>().not.toHaveProperty('planContentHash');
  expectTypeOf<RuntimeTransaction>().not.toHaveProperty('startActivity');
  expectTypeOf<RuntimeTransaction>().not.toHaveProperty('planContentHash');
  expectTypeOf<TransactionContext>().not.toHaveProperty('startActivity');
  expectTypeOf<TransactionContext>().not.toHaveProperty('planContentHash');
});

test('a handle is typed by its kind, and nests through its own members', async () => {
  const runtime = {} as Runtime;
  const call = await startActivityOn(runtime, {
    kind: 'test-call',
    contentHash: async () => 'hash',
  });
  expectTypeOf(call).toEqualTypeOf<ActivityHandle<'test-call'>>();
  expectTypeOf(call.activity).toEqualTypeOf<ClientActivity<'test-call'>>();
  expectTypeOf(call.intercepted).toEqualTypeOf<
    { readonly result: ReadonlyArray<{ readonly id: number }> } | undefined
  >();
  expectTypeOf(call.transaction).toEqualTypeOf<(() => Promise<RuntimeTransaction>) | undefined>();
  expectTypeOf(call.startActivity).toBeFunction();
  expectTypeOf(call.planContentHash).toBeFunction();
  // @ts-expect-error - statement is not a client kind
  void startActivityOn(runtime, { kind: 'statement', contentHash: async () => 'hash' });
});
