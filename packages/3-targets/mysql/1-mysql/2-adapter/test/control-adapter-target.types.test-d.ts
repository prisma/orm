import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import type { MysqlCodecRegistry } from '@internal/target-mysql/codecs';
import { expectTypeOf, test } from 'vitest';
import {
  createMysqlControlAdapter,
  MysqlControlAdapter,
} from '../src/core/migrations/control-adapter';
import { readMysqlCatalog } from '../src/core/migrations/introspection-queries';
import mysqlAdapterDescriptor from '../src/exports/control';

declare const mariadbStack: ControlStack<'sql', 'mariadb'>;

test('the control adapter carries the target id of its stack', () => {
  expectTypeOf(
    createMysqlControlAdapter(mariadbStack, { readCatalog: readMysqlCatalog }),
  ).toEqualTypeOf<SqlControlAdapter<'mariadb'>>();
  expectTypeOf(mysqlAdapterDescriptor.create).returns.toEqualTypeOf<SqlControlAdapter<'mysql'>>();
  expectTypeOf<MysqlControlAdapter<'mariadb'>['targetId']>().toEqualTypeOf<'mariadb'>();
});

declare const codecRegistry: MysqlCodecRegistry;

test('the control adapter is built only with the target id it carries', () => {
  // @ts-expect-error the adapter needs its target id and catalog reader
  new MysqlControlAdapter(codecRegistry, []);
});
