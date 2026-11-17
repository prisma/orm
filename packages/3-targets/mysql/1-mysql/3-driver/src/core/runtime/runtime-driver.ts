import type { SessionSettings } from '@internal/framework-components/components';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { ifDefined } from '@internal/utils/defined';
import { mysqlDriverDescriptorMetaFor } from '../descriptor-meta';
import {
  MysqlDriver,
  type MysqlDriverCreateOptions,
  type MysqlRuntimeDriver,
} from './mysql-driver';

/** The runtime driver descriptor of MySQL, or of a target that extends it, whose drivers carry `targetId`. */
export function createMysqlRuntimeDriverDescriptor<TargetId extends string>(
  targetId: TargetId,
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
      );
    },
  };
}

const mysqlRuntimeDriverDescriptor = createMysqlRuntimeDriverDescriptor('mysql');

export default mysqlRuntimeDriverDescriptor;
