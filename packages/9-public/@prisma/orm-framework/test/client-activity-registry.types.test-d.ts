import type {
  ClientActivity,
  ClientActivityResult,
  CrossFamilyMiddleware,
  StartActivity,
} from '@prisma/orm-framework/components/runtime';
import { expectTypeOf, test } from 'vitest';

declare module '@prisma/orm-framework/components/runtime' {
  interface ClientActivityRegistry {
    'published-call': { result: { readonly published: true } };
  }
}

test('a kind registered through the published entry types its result', () => {
  expectTypeOf<ClientActivityResult<'published-call'>>().toEqualTypeOf<{
    readonly published: true;
  }>();
  expectTypeOf<ClientActivityResult<'other-call'>>().toEqualTypeOf<unknown>();
});

test('narrowing on the registered kind reaches its registered result type', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'published',
    async activityStarted(activity) {
      if (activity.kind === 'published-call') {
        expectTypeOf<ClientActivityResult<typeof activity.kind>>().toEqualTypeOf<{
          readonly published: true;
        }>();
      }
    },
  };
  void middleware;
});

test('a client supplies the content hash as a function, and middleware reads it as a method', () => {
  expectTypeOf<StartActivity['contentHash']>().toEqualTypeOf<() => Promise<string>>();
  expectTypeOf<ClientActivity['contentHash']>().toEqualTypeOf<() => Promise<string>>();
});
