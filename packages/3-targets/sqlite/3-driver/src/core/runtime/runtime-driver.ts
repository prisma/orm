import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { SqliteDriver, type SqliteRuntimeDriver } from '../../sqlite-driver';
import { sqliteDriverDescriptorMeta } from '../descriptor-meta';

export type { SqliteRuntimeDriver } from '../../sqlite-driver';

const sqliteRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'sqlite',
  void,
  SqliteRuntimeDriver
> = {
  ...sqliteDriverDescriptorMeta,
  create(): SqliteRuntimeDriver {
    return new SqliteDriver();
  },
};

export default sqliteRuntimeDriverDescriptor;
