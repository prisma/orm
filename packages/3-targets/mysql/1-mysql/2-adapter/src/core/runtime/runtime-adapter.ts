import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import {
  assembleMysqlCodecRegistry,
  type MysqlCodecRegistry,
  mysqlCodecDescriptorRegistry,
} from '@internal/target-mysql/codecs';
import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/descriptor-meta-runtime';
import { type MysqlRuntimeTargetMeta, mysqlNowGenerators } from '@internal/target-mysql/runtime';
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

export type MysqlRuntimeAdapterDescriptor<TargetId extends string = 'mysql'> =
  SqlRuntimeAdapterDescriptor<TargetId, MysqlRuntimeAdapterInstance<TargetId>>;

/** What a target that extends MySQL changes in the runtime adapter descriptor. */
export interface MysqlRuntimeAdapterOptions<TargetId extends string> {
  /** The adapter's metadata: everything but what the factory supplies. */
  readonly descriptorMeta: Omit<
    MysqlRuntimeAdapterDescriptor<TargetId>,
    'codecs' | 'mutationDefaultGenerators' | 'rawCodecInferer' | 'create'
  >;
  /** The target's runtime metadata, whose id and display name the renderer's errors show. Its id is the adapter metadata's. */
  readonly target: Pick<MysqlRuntimeTargetMeta<NoInfer<TargetId>>, 'targetId' | 'displayName'>;
  /** Builds the renderer that writes the target's SQL. */
  readonly renderer: (
    codecs: MysqlCodecRegistry,
    target: Pick<MysqlRuntimeTargetMeta<TargetId>, 'targetId' | 'displayName'>,
  ) => MysqlSqlRenderer;
}

/** The runtime adapter descriptor of MySQL, or of a target that extends it. Its profile id is `<targetId>/default@1`. */
export function createMysqlRuntimeAdapterDescriptor<TargetId extends string>(
  options: MysqlRuntimeAdapterOptions<TargetId>,
): MysqlRuntimeAdapterDescriptor<TargetId> {
  const { descriptorMeta, target } = options;
  return {
    ...descriptorMeta,
    codecs: () => Array.from(mysqlCodecDescriptorRegistry.values()),
    mutationDefaultGenerators: createMysqlMutationDefaultGenerators,
    rawCodecInferer: mysqlRawCodecInferer,
    create(stack): MysqlRuntimeAdapterInstance<TargetId> {
      return createMysqlAdapter({
        targetId: descriptorMeta.targetId,
        capabilities: descriptorMeta.capabilities ?? {},
        renderer: options.renderer(
          assembleMysqlCodecRegistry(stack.target, stack.extensions),
          target,
        ),
      });
    },
  };
}

const mysqlRuntimeAdapterDescriptor = createMysqlRuntimeAdapterDescriptor({
  descriptorMeta: mysqlAdapterDescriptorMeta,
  target: mysqlTargetDescriptorMetaRuntime,
  renderer: (codecs, target) => new MysqlSqlRenderer(codecs, target),
});

export default mysqlRuntimeAdapterDescriptor;
