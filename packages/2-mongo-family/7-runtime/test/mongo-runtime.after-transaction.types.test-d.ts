import type { CrossFamilyMiddleware } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { MongoMiddleware } from '../src/mongo-middleware';

test('a cross-family middleware with afterTransaction is a Mongo middleware', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'after-transaction',
    async afterTransaction(_plan, result) {
      expectTypeOf(result.outcome).toEqualTypeOf<'committed' | 'rolled-back' | 'unknown'>();
    },
  };

  const mongoMiddleware: MongoMiddleware[] = [middleware];
  void mongoMiddleware;
});
