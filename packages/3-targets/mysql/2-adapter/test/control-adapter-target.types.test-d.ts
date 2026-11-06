import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import { expectTypeOf, test } from 'vitest';
import {
  createMysqlControlAdapter,
  type MysqlControlAdapter,
} from '../src/core/migrations/control-adapter';
import { readMysqlCatalog } from '../src/core/migrations/introspection-queries';
import mysqlAdapterDescriptor from '../src/exports/control';

declare const mariadbStack: ControlStack<'sql', 'mariadb'>;

test('the control adapter carries the target id it is given, and MySQL by default', () => {
  expectTypeOf(
    createMysqlControlAdapter(mariadbStack, { targetId: 'mariadb', readCatalog: readMysqlCatalog }),
  ).toEqualTypeOf<SqlControlAdapter<'mariadb'>>();
  expectTypeOf(mysqlAdapterDescriptor.create).returns.toEqualTypeOf<SqlControlAdapter<'mysql'>>();
  expectTypeOf<MysqlControlAdapter['targetId']>().toEqualTypeOf<'mysql'>();
  expectTypeOf<MysqlControlAdapter<'mariadb'>['targetId']>().toEqualTypeOf<'mariadb'>();
});

test('the target id of the options must be the stack target', () => {
  createMysqlControlAdapter(mariadbStack, {
    // @ts-expect-error a MariaDB stack builds no MySQL adapter
    targetId: 'mysql',
    readCatalog: readMysqlCatalog,
  });
});
