import type { RuntimeTargetInstance } from '@internal/framework-components/execution';
import type { SqlRuntimeTargetDescriptor } from '@internal/sql-runtime';
import { mysqlTargetDescriptorMetaRuntime } from '../descriptor-meta-runtime';

export interface MysqlRuntimeTargetInstance<TargetId extends string = 'mysql'>
  extends RuntimeTargetInstance<'sql', TargetId> {}

/** The runtime target descriptor of MySQL, or of a target that extends it, with the name its messages show. */
export type MysqlRuntimeTargetDescriptor<TargetId extends string = 'mysql'> =
  SqlRuntimeTargetDescriptor<TargetId, MysqlRuntimeTargetInstance<TargetId>> & {
    readonly displayName: string;
  };

/** What the runtime target descriptor is built from: everything but what the factory supplies. */
export type MysqlRuntimeTargetMeta<TargetId extends string> = Omit<
  MysqlRuntimeTargetDescriptor<TargetId>,
  'codecs' | 'create'
>;

export interface MysqlRuntimeTargetOptions<TargetId extends string> {
  readonly descriptorMeta: MysqlRuntimeTargetMeta<TargetId>;
}

/** The runtime target descriptor of MySQL, or of a target that extends it. */
export function createMysqlRuntimeTargetDescriptor<TargetId extends string>(
  options: MysqlRuntimeTargetOptions<TargetId>,
): MysqlRuntimeTargetDescriptor<TargetId> {
  const { descriptorMeta } = options;
  return {
    ...descriptorMeta,
    codecs: () => [],
    create(): MysqlRuntimeTargetInstance<TargetId> {
      return { familyId: 'sql', targetId: descriptorMeta.targetId };
    },
  };
}

const mysqlRuntimeTargetDescriptor = createMysqlRuntimeTargetDescriptor({
  descriptorMeta: mysqlTargetDescriptorMetaRuntime,
});

export default mysqlRuntimeTargetDescriptor;
