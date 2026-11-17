import type { SessionSettings } from '@internal/framework-components/components';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { ifDefined } from '@internal/utils/defined';
import { mysqlDriverDescriptorMetaFor } from '../descriptor-meta';
import {
  MysqlDriver,
  type MysqlDriverCreateOptions,
  type MysqlRuntimeDriver,
} from './mysql-driver';

/** The runtime driver descriptor of MySQL, or of a target that extends it, whose drivers carry `targetId` and name the database as `displayName` in their errors. */
export function createMysqlRuntimeDriverDescriptor<TargetId extends string>(
  targetId: TargetId,
  displayName: string,
): RuntimeDriverDescriptor<
  'sql',
  TargetId,
  MysqlDriverCreateOptions,
  MysqlRuntimeDriver<TargetId>
> {
  return {
    ...mysqlDriverDescriptorMetaFor(targetId),
    create(
      options?: MysqlDriverCreateOptions,
      sessionSettings?: SessionSettings,
    ): MysqlRuntimeDriver<TargetId> {
      return new MysqlDriver(
        { ...options, ...ifDefined('sessionSettings', sessionSettings) },
        targetId,
        displayName,
      );
    },
  };
}

const mysqlRuntimeDriverDescriptor = createMysqlRuntimeDriverDescriptor('mysql', 'MySQL');

export default mysqlRuntimeDriverDescriptor;
