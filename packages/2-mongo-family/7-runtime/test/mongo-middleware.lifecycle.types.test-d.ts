import type { CrossFamilyMiddleware } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { MongoMiddleware } from '../src/mongo-middleware';

test('a cross-family middleware with only lifecycle events is a Mongo middleware', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'lifecycle',
    async activityStarted() {},
    async activityEnded() {},
    async activityFinalized(_activity, result) {
      expectTypeOf(result.outcome).toEqualTypeOf<'committed' | 'rolled-back' | 'unknown'>();
    },
  };

  const mongoMiddleware: MongoMiddleware[] = [middleware];
  void mongoMiddleware;
});

test('intercept.onQuery returning statistics does not compile on a Mongo middleware', () => {
  const middleware: MongoMiddleware = {
    name: 'wrong',
    intercept: {
      // @ts-expect-error - onQuery supplies rows, not statistics
      async onQuery() {
        return { stats: { affectedRows: 1 } };
      },
    },
  };
  void middleware;
});
