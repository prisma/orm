import type { RuntimeTargetInstance } from '@internal/framework-components/execution';
import type { SqlRuntimeTargetDescriptor } from '@internal/sql-runtime';
import { mysqlTargetDescriptorMetaRuntime } from '../descriptor-meta-runtime';

export interface MysqlRuntimeTargetInstance<TargetId extends string = 'mysql'>
  extends RuntimeTargetInstance<'sql', TargetId> {}

/** The runtime metadata of MySQL, or of a database that extends it: MySQL's, under its own target id and display name. */
export type MysqlRuntimeTargetMeta<TargetId extends string> = Omit<
  typeof mysqlTargetDescriptorMetaRuntime,
  'targetId' | 'id' | 'displayName'
> & {
  readonly targetId: TargetId;
  readonly id: string;
  readonly displayName: string;
};

export type MysqlRuntimeTargetDescriptor<TargetId extends string = 'mysql'> =
  SqlRuntimeTargetDescriptor<TargetId, MysqlRuntimeTargetInstance<TargetId>> &
    MysqlRuntimeTargetMeta<TargetId>;

/** The runtime target descriptor of MySQL, or of a database that extends it, built from its metadata. */
export function createMysqlRuntimeTargetDescriptor<TargetId extends string>(
  meta: MysqlRuntimeTargetMeta<TargetId>,
): MysqlRuntimeTargetDescriptor<TargetId> {
  return {
    ...meta,
    codecs: () => [],
    create(): MysqlRuntimeTargetInstance<TargetId> {
      return { familyId: 'sql', targetId: meta.targetId };
    },
  };
}

const mysqlRuntimeTargetDescriptor = createMysqlRuntimeTargetDescriptor(
  mysqlTargetDescriptorMetaRuntime,
);

export default mysqlRuntimeTargetDescriptor;
