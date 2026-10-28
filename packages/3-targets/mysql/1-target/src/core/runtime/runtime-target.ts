import type { RuntimeTargetInstance } from '@internal/framework-components/execution';
import type { SqlRuntimeTargetDescriptor } from '@internal/sql-runtime';
import { mysqlTargetDescriptorMetaRuntime } from '../descriptor-meta-runtime';

export interface MysqlRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'mysql'> {}

const mysqlRuntimeTargetDescriptor: SqlRuntimeTargetDescriptor<
  'mysql',
  MysqlRuntimeTargetInstance
> = {
  ...mysqlTargetDescriptorMetaRuntime,
  codecs: () => [],
  create(): MysqlRuntimeTargetInstance {
    return { familyId: 'sql', targetId: 'mysql' };
  },
};

export default mysqlRuntimeTargetDescriptor;
