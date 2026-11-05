import { expectTypeOf, test } from 'vitest';
import { type SqlExecutionOptions, toRuntimeOptions } from '../src/execution-options';
import type { RuntimeExecutionOptions, RuntimeOptions } from '../src/sql-runtime';

test('the runtime options include the execution options', () => {
  expectTypeOf<
    Pick<RuntimeOptions, keyof RuntimeExecutionOptions>
  >().toEqualTypeOf<RuntimeExecutionOptions>();
});

test('the SQL execution options are the runtime execution options plus extensions', () => {
  expectTypeOf<
    Omit<SqlExecutionOptions<'postgres'>, 'extensions'>
  >().toEqualTypeOf<RuntimeExecutionOptions>();
});

test('toRuntimeOptions returns the runtime execution options', () => {
  expectTypeOf(toRuntimeOptions).returns.toEqualTypeOf<RuntimeExecutionOptions>();
});
