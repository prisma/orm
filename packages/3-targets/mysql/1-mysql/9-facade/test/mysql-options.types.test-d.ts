import type { SqlExecutionOptions } from '@internal/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type { MysqlOptionsBase, MysqlTargetId } from '../src/runtime/mysql';

test('mysql() takes every SQL execution option', () => {
  expectTypeOf<Pick<MysqlOptionsBase, keyof SqlExecutionOptions<MysqlTargetId>>>().toEqualTypeOf<
    SqlExecutionOptions<MysqlTargetId>
  >();
});
