import { expectTypeOf, test } from 'vitest';
import { type SqlExecutionOptions, toRuntimeOptions } from '../src/execution-options';
import type { RuntimeOptions } from '../src/sql-runtime';

type RuntimeExecutionOptions = Pick<RuntimeOptions, 'verifyMarker' | 'middleware' | 'log' | 'mode'>;

test('the execution options are the runtime options plus extensions', () => {
  expectTypeOf<
    Omit<SqlExecutionOptions<'postgres'>, 'extensions'>
  >().toEqualTypeOf<RuntimeExecutionOptions>();
});

test('toRuntimeOptions returns the runtime options it passes on', () => {
  expectTypeOf(toRuntimeOptions).returns.toEqualTypeOf<RuntimeExecutionOptions>();
});
