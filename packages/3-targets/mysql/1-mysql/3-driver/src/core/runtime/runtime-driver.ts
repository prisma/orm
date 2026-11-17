import type { SessionSettings } from '@internal/framework-components/components';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/descriptor-meta-runtime';
import type { MysqlRuntimeTargetMeta } from '@internal/target-mysql/runtime';
import { ifDefined } from '@internal/utils/defined';
import { mysqlDriverDescriptorMetaFor } from '../descriptor-meta';
import {
  MysqlDriver,
  type MysqlDriverCreateOptions,
  type MysqlRuntimeDriver,
} from './mysql-driver';

export interface MysqlRuntimeDriverOptions<TargetId extends string> {
  /** The target's runtime metadata: its drivers carry its id and name it by its display name in their errors. */
  readonly target: Pick<MysqlRuntimeTargetMeta<TargetId>, 'targetId' | 'displayName'>;
}

/** The runtime driver descriptor of MySQL, or of a target that extends it. */
export function createMysqlRuntimeDriverDescriptor<TargetId extends string>(
  options: MysqlRuntimeDriverOptions<TargetId>,
): RuntimeDriverDescriptor<
  'sql',
  TargetId,
  MysqlDriverCreateOptions,
  MysqlRuntimeDriver<TargetId>
> {
  const { targetId, displayName } = options.target;
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

const mysqlRuntimeDriverDescriptor = createMysqlRuntimeDriverDescriptor({
  target: mysqlTargetDescriptorMetaRuntime,
});

export default mysqlRuntimeDriverDescriptor;
