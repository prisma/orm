import type { RuntimeTargetInstance } from '@internal/framework-components/execution';
import type { SqlRuntimeTargetDescriptor } from '@internal/sql-runtime';
import { sqliteTargetDescriptorMetaRuntime } from '../descriptor-meta-runtime';

export interface SqliteRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'sqlite'> {}

const sqliteRuntimeTargetDescriptor: SqlRuntimeTargetDescriptor<
  'sqlite',
  SqliteRuntimeTargetInstance
> = {
  ...sqliteTargetDescriptorMetaRuntime,
  codecs: () => [],
  create(): SqliteRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'sqlite',
    };
  },
};

export default sqliteRuntimeTargetDescriptor;
