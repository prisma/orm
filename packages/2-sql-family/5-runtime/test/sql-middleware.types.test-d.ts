import type {
  Activity,
  ActivityEndedResult,
  CrossFamilyMiddleware,
} from '@internal/framework-components/runtime';
import { assertType, expectTypeOf, test } from 'vitest';
import type { SqlMiddleware, SqlMiddlewareContext } from '../src/middleware/sql-middleware';

test('a cross-family middleware with only lifecycle events is a SQL middleware', () => {
  const middleware: CrossFamilyMiddleware = {
    name: 'lifecycle',
    async activityStarted() {},
    async activityEnded(_activity, result) {
      if (result.kind === 'statement' && result.returns === 'rows') {
        expectTypeOf(result.rowCount).toEqualTypeOf<number>();
      }
    },
    async activityFinalized(_activity, result) {
      expectTypeOf(result.outcome).toEqualTypeOf<'committed' | 'rolled-back' | 'unknown'>();
    },
  };

  const sqlMiddleware: SqlMiddleware[] = [middleware];
  void sqlMiddleware;
});

test('SQL middleware hooks receive the SQL context', () => {
  const middleware: SqlMiddleware = {
    name: 'sql',
    async activityEnded(_activity: Activity, _result: ActivityEndedResult, ctx) {
      assertType<SqlMiddlewareContext>(ctx);
    },
    async beforeEncode(plan, ctx) {
      assertType<string>(plan.sql);
      assertType<SqlMiddlewareContext>(ctx);
    },
    intercept: {
      async onQuery(_plan, ctx) {
        assertType<SqlMiddlewareContext>(ctx);
        return undefined;
      },
    },
  };
  void middleware;
});

test('intercept.onQuery returning statistics does not compile on a SQL middleware', () => {
  const middleware: SqlMiddleware = {
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
