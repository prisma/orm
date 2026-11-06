import type { RuntimeFamilyDescriptor } from '@internal/framework-components/execution';
import { createSqlRuntimeFamilyInstance, type SqlRuntimeFamilyInstance } from './runtime-instance';

/**
 * SQL execution-plane family descriptor.
 *
 * Note: this is currently named `sqlRuntimeFamilyDescriptor` because the execution plane
 * framework types are still using the `Runtime*` naming (`RuntimeFamilyDescriptor`, etc.).
 *
 * This will be renamed to `sqlExecutionFamilyDescriptor` as part of `TML-1842`.
 */
export const sqlRuntimeFamilyDescriptor: RuntimeFamilyDescriptor<'sql', SqlRuntimeFamilyInstance> =
  {
    kind: 'family',
    id: 'sql',
    familyId: 'sql',
    version: '0.0.1',
    create() {
      return createSqlRuntimeFamilyInstance();
    },
  };

Object.freeze(sqlRuntimeFamilyDescriptor);
