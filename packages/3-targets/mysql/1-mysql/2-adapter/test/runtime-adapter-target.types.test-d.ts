import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/descriptor-meta-runtime';
import { expectTypeOf, test } from 'vitest';
import { mysqlAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import {
  createMysqlRuntimeAdapterDescriptor,
  type MysqlRuntimeAdapterDescriptor,
} from '../src/core/runtime/runtime-adapter';
import { MysqlSqlRenderer } from '../src/core/sql-renderer';

test('the runtime adapter descriptor carries the target id its metadata and target share', () => {
  expectTypeOf(
    createMysqlRuntimeAdapterDescriptor({
      descriptorMeta: mysqlAdapterDescriptorMeta,
      target: mysqlTargetDescriptorMetaRuntime,
      renderer: (codecs, target) => new MysqlSqlRenderer(codecs, target),
    }),
  ).toEqualTypeOf<MysqlRuntimeAdapterDescriptor<'mysql'>>();
});

test('the runtime adapter descriptor refuses a target whose id differs from its metadata', () => {
  createMysqlRuntimeAdapterDescriptor({
    descriptorMeta: mysqlAdapterDescriptorMeta,
    // @ts-expect-error the target's id must be the adapter metadata's
    target: { targetId: 'mariadb', displayName: 'MariaDB' },
    renderer: (codecs, target) => new MysqlSqlRenderer(codecs, target),
  });
});
