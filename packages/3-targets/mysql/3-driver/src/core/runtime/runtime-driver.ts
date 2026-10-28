import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { mysqlDriverDescriptorMeta } from '../descriptor-meta';
import { MysqlDriver, type MysqlRuntimeDriver } from './mysql-driver';

const mysqlRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'mysql',
  void,
  MysqlRuntimeDriver
> = {
  ...mysqlDriverDescriptorMeta,
  create(): MysqlRuntimeDriver {
    return new MysqlDriver();
  },
};

export default mysqlRuntimeDriverDescriptor;
