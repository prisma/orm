import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
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
    ControlDriverDescriptor<'sql', 'mariadb', SqlControlDriverInstance<'mariadb'>>
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

test('MysqlControlDriver is built from a connection alone and carries the MySQL target id', () => {
  expectTypeOf(new MysqlControlDriver(connection).targetId).toEqualTypeOf<'mysql'>();
  // @ts-expect-error MysqlControlDriver is fixed to MySQL and takes no target id
  new MysqlControlDriver(connection, 'mariadb');
});

test('the runtime driver is built only with the target id it carries', () => {
  // @ts-expect-error the runtime driver needs its target id
  new MysqlDriver({});
});
