import type { Contract } from '@internal/contract/types';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import type { SqlStorage } from '@internal/sql-contract/types';
import { test } from 'vitest';
import type { SqlExecutionStack, SqlRuntimeDriverInstance } from '../src/sql-context';
import { createExecutionContext } from '../src/sql-context';

declare const contract: Contract<SqlStorage>;
declare const stack: SqlExecutionStack<'postgres'>;
declare const driver: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  unknown,
  SqlRuntimeDriverInstance<'postgres'>
>;

test('a call with the driver option of release candidate 25 compiles', () => {
  createExecutionContext({ contract, stack });
  createExecutionContext({ contract, stack, driver });
});
