import type { SessionSettings } from '@internal/framework-components/components';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { ifDefined } from '@internal/utils/defined';
import { mysqlDriverDescriptorMeta } from '../descriptor-meta';
import {
  MysqlDriver,
  type MysqlDriverCreateOptions,
  type MysqlRuntimeDriver,
} from './mysql-driver';

const mysqlRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'mysql',
  MysqlDriverCreateOptions,
  MysqlRuntimeDriver
> = {
  ...mysqlDriverDescriptorMeta,
  create(
    options?: MysqlDriverCreateOptions,
    sessionSettings?: SessionSettings,
  ): MysqlRuntimeDriver {
    return new MysqlDriver({ ...options, ...ifDefined('sessionSettings', sessionSettings) });
  },
};

export default mysqlRuntimeDriverDescriptor;
