import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import type { Connection } from 'mariadb';
import { expectTypeOf, test } from 'vitest';
import mysqlControlDriver, {
  createMysqlControlDriverDescriptor,
  MysqlControlDriver,
} from '../src/core/migrations/control-driver';
import {
  MysqlDriver,
  type MysqlDriverCreateOptions,
  type MysqlRuntimeDriver,
} from '../src/core/runtime/mysql-driver';
import mysqlRuntimeDriver, {
  createMysqlRuntimeDriverDescriptor,
} from '../src/core/runtime/runtime-driver';

test('the driver descriptors carry the target id they are built for, and MySQL by default', () => {
  expectTypeOf(createMysqlControlDriverDescriptor('mariadb')).toEqualTypeOf<
    ControlDriverDescriptor<'sql', 'mariadb', MysqlControlDriver<'mariadb'>>
  >();
  expectTypeOf(createMysqlRuntimeDriverDescriptor('mariadb')).toEqualTypeOf<
    RuntimeDriverDescriptor<
      'sql',
      'mariadb',
      MysqlDriverCreateOptions,
      MysqlRuntimeDriver<'mariadb'>
    >
  >();
  expectTypeOf(mysqlControlDriver).toEqualTypeOf<
    ControlDriverDescriptor<'sql', 'mysql', MysqlControlDriver>
  >();
  expectTypeOf(mysqlRuntimeDriver).toEqualTypeOf<
    RuntimeDriverDescriptor<'sql', 'mysql', MysqlDriverCreateOptions, MysqlRuntimeDriver>
  >();
  expectTypeOf<MysqlControlDriver['targetId']>().toEqualTypeOf<'mysql'>();
  expectTypeOf<MysqlDriver<'mariadb'>['targetId']>().toEqualTypeOf<'mariadb'>();
});

declare const connection: Connection;

test('a driver is built only with the target id it carries', () => {
  // @ts-expect-error the control driver needs its target id
  new MysqlControlDriver(connection);
  // @ts-expect-error the runtime driver needs its target id
  new MysqlDriver({});
  expectTypeOf(new MysqlControlDriver(connection, 'mariadb').targetId).toEqualTypeOf<'mariadb'>();
});
