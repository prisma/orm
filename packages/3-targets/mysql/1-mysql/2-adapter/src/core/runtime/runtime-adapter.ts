import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import {
  assembleMysqlCodecRegistry,
  type MysqlCodecRegistry,
  mysqlCodecDescriptorRegistry,
} from '@internal/target-mysql/codecs';
import { mysqlNowGenerators } from '@internal/target-mysql/runtime';
import { mysqlAdapterDescriptorMeta } from '../descriptor-meta';
import { mysqlRawCodecInferer } from '../raw-codec-inferer';
import { MysqlSqlRenderer } from '../sql-renderer';
import { createMysqlAdapter } from './mysql-adapter';

/** The `now()` generators of the MySQL date and time types: the SQL family's `timestampNow` for a `Date`, and the target's for every other value. */
function createMysqlMutationDefaultGenerators(): ReadonlyArray<RuntimeMutationDefaultGenerator> {
  return [
    timestampNowRuntimeGenerator(),
    ...mysqlNowGenerators.map(
      ({ id, generate }): RuntimeMutationDefaultGenerator => ({
        id,
        generate,
        stability: 'query',
      }),
    ),
  ];
}

export type MysqlRuntimeAdapterInstance<TargetId extends string = 'mysql'> = RuntimeAdapterInstance<
  'sql',
  TargetId
> &
  ReturnType<typeof createMysqlAdapter<TargetId>>;

type MysqlAdapterTypes = (typeof mysqlAdapterDescriptorMeta)['types'];

/** The adapter metadata of MySQL, or of a database that extends it: MySQL's, under its own target id, id, capabilities and codec-type import. */
export type MysqlRuntimeAdapterMeta<TargetId extends string> = Omit<
  typeof mysqlAdapterDescriptorMeta,
  'targetId' | 'id' | 'capabilities' | 'types'
> & {
  readonly targetId: TargetId;
  readonly id: string;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly types: Omit<MysqlAdapterTypes, 'codecTypes'> & {
    readonly codecTypes: Omit<MysqlAdapterTypes['codecTypes'], 'import'> & {
      readonly import: { readonly package: string; readonly named: string; readonly alias: string };
    };
  };
};

/** What a database that extends MySQL changes in the runtime adapter descriptor. */
export interface MysqlRuntimeAdapterOptions<TargetId extends string> {
  /** The adapter metadata: its target id and the capabilities it reports. */
  readonly meta: MysqlRuntimeAdapterMeta<TargetId>;
  /** The id of the adapter profile, whose `target` is the target id. */
  readonly profileId: string;
  /** Builds the renderer that writes the database's SQL. */
  readonly renderer: (codecs: MysqlCodecRegistry) => MysqlSqlRenderer;
}

/** The runtime adapter descriptor of MySQL, or of a database that extends it. */
export function createMysqlRuntimeAdapterDescriptor<TargetId extends string>(
  options: MysqlRuntimeAdapterOptions<TargetId>,
): SqlRuntimeAdapterDescriptor<TargetId, MysqlRuntimeAdapterInstance<TargetId>> {
  const { meta } = options;
  return {
    ...meta,
    codecs: () => Array.from(mysqlCodecDescriptorRegistry.values()),
    mutationDefaultGenerators: createMysqlMutationDefaultGenerators,
    rawCodecInferer: mysqlRawCodecInferer,
    create(stack): MysqlRuntimeAdapterInstance<TargetId> {
      return createMysqlAdapter({
        targetId: meta.targetId,
        profileId: options.profileId,
        capabilities: meta.capabilities,
        renderer: options.renderer(assembleMysqlCodecRegistry(stack.target, stack.extensions)),
      });
    },
  };
}

const mysqlRuntimeAdapterDescriptor = createMysqlRuntimeAdapterDescriptor({
  meta: mysqlAdapterDescriptorMeta,
  profileId: 'mysql/default@1',
  renderer: (codecs) => new MysqlSqlRenderer(codecs),
});

export default mysqlRuntimeAdapterDescriptor;
