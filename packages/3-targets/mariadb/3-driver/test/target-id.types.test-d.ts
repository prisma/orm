import type { MysqlControlDriver } from '@internal/driver-mysql/control';
import type { MysqlDriverCreateOptions, MysqlRuntimeDriver } from '@internal/driver-mysql/runtime';
import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { expectTypeOf, test } from 'vitest';
import mariadbControlDriver from '../src/exports/control';
import mariadbRuntimeDriver from '../src/exports/runtime';

test('the MariaDB driver descriptors carry the MariaDB target id', () => {
  expectTypeOf(mariadbControlDriver).toEqualTypeOf<
    ControlDriverDescriptor<'sql', 'mariadb', MysqlControlDriver<'mariadb'>>
  >();
  expectTypeOf(mariadbRuntimeDriver).toEqualTypeOf<
    RuntimeDriverDescriptor<
      'sql',
      'mariadb',
      MysqlDriverCreateOptions,
      MysqlRuntimeDriver<'mariadb'>
    >
  >();
});
