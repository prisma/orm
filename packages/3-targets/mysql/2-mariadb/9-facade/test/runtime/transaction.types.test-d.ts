import type { Contract } from '@internal/contract/types';
import type { MysqlTransactionContext } from '@internal/mysql/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { MariadbTransactionContext } from '../../src/exports/runtime';

type TestContract = Contract<SqlStorage>;

test('tx.transaction on MariaDB is the one MySQL has', () => {
  expectTypeOf<MariadbTransactionContext<TestContract>['transaction']>().toEqualTypeOf<
    MysqlTransactionContext<TestContract>['transaction']
  >();
});
