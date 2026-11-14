import type { SqlExecutionOptions } from '@internal/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type { PostgresOptionsBase, PostgresPoolOptions } from '../src/exports/runtime';
import type {
  PostgresCursorOptions,
  PostgresExecutionOptions,
} from '../src/runtime/postgres-options';
import type { PostgresTargetId } from '../src/runtime/postgres-target-id';

test('postgres() takes every SQL execution option, plus cursor, prepare and transaction options', () => {
  expectTypeOf<
    Omit<PostgresExecutionOptions, 'cursor' | 'prepare' | 'transactionOptions'>
  >().toEqualTypeOf<SqlExecutionOptions<PostgresTargetId>>();
  expectTypeOf<PostgresExecutionOptions['cursor']>().toEqualTypeOf<
    PostgresCursorOptions | undefined
  >();
  expectTypeOf<PostgresExecutionOptions['prepare']>().toEqualTypeOf<
    'client' | 'database' | undefined
  >();
});

test('the runtime entry exports the type of poolOptions', () => {
  expectTypeOf<PostgresOptionsBase['poolOptions']>().toEqualTypeOf<
    PostgresPoolOptions | undefined
  >();
});
