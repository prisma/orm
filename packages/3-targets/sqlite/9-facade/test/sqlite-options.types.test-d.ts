import type { SqlExecutionOptions } from '@internal/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type { SqliteOptionsBase, SqliteTargetId } from '../src/runtime/sqlite';

test('sqlite() takes every SQL execution option', () => {
  expectTypeOf<Pick<SqliteOptionsBase, keyof SqlExecutionOptions<SqliteTargetId>>>().toEqualTypeOf<
    SqlExecutionOptions<SqliteTargetId>
  >();
});
