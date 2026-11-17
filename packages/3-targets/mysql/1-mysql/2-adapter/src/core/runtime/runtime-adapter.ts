import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import {
  assembleMysqlCodecRegistry,
  mysqlCodecDescriptorRegistry,
} from '@internal/target-mysql/codecs';
import { mysqlNowGenerators } from '@internal/target-mysql/runtime';
import { mysqlAdapterDescriptorMeta } from '../descriptor-meta';
import { mysqlRawCodecInferer } from '../raw-codec-inferer';
import { createMysqlAdapter } from './mysql-adapter';

/** The `now()` generators of the MySQL date and time types: the SQL family's `timestampNow` for a `Date`, and the target's for every other value. */
function createMysqlMutationDefaultGenerators(): ReadonlyArray<RuntimeMutationDefaultGenerator> {
  return [
    timestampNowRuntimeGenerator(),
    ...mysqlNowGenerators.map(
      ({ id, generate }): RuntimeMutationDefaultGenerator => ({
        id,
        generate,
        stability: 'query',
      }),
    ),
  ];
}

export type MysqlRuntimeAdapterInstance = RuntimeAdapterInstance<'sql', 'mysql'> &
  ReturnType<typeof createMysqlAdapter>;

const mysqlRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<
  'mysql',
  MysqlRuntimeAdapterInstance
> = {
  ...mysqlAdapterDescriptorMeta,
  codecs: () => Array.from(mysqlCodecDescriptorRegistry.values()),
  mutationDefaultGenerators: createMysqlMutationDefaultGenerators,
  rawCodecInferer: mysqlRawCodecInferer,
  create(stack): MysqlRuntimeAdapterInstance {
    return createMysqlAdapter(assembleMysqlCodecRegistry(stack.target, stack.extensions));
  },
};

export default mysqlRuntimeAdapterDescriptor;
