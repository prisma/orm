import type { CrossFamilyMiddleware } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { SqlMiddleware } from '../src/middleware/sql-middleware';

test('a cross-family middleware with afterTransaction is a SQL middleware', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'after-transaction',
    async afterTransaction(_plan, result) {
      expectTypeOf(result.outcome).toEqualTypeOf<'committed' | 'rolled-back' | 'unknown'>();
    },
  };

  const sqlMiddleware: SqlMiddleware[] = [middleware];
  void sqlMiddleware;
});
