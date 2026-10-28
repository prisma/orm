import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import {
  assembleMysqlCodecRegistry,
  mysqlCodecDescriptorRegistry,
} from '@internal/target-mysql/codecs';
import { mysqlAdapterDescriptorMeta } from '../descriptor-meta';
import { mysqlRawCodecInferer } from '../raw-codec-inferer';
import { createMysqlAdapter } from './mysql-adapter';

export type MysqlRuntimeAdapterInstance = RuntimeAdapterInstance<'sql', 'mysql'> &
  ReturnType<typeof createMysqlAdapter>;

const mysqlRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<
  'mysql',
  MysqlRuntimeAdapterInstance
> = {
  ...mysqlAdapterDescriptorMeta,
  codecs: () => Array.from(mysqlCodecDescriptorRegistry.values()),
  rawCodecInferer: mysqlRawCodecInferer,
  create(stack): MysqlRuntimeAdapterInstance {
    return createMysqlAdapter(assembleMysqlCodecRegistry(stack.target, stack.extensions));
  },
};

export default mysqlRuntimeAdapterDescriptor;
