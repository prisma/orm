import type { GeneratedValueSpec } from '@internal/contract/types';
import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import { builtinGeneratorIds } from '@internal/ids';
import { generateId } from '@internal/ids/runtime';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { createSqliteAdapterWithCodecRegistry, sqliteRawCodecInferer } from './adapter';
import { assembleSqliteCodecRegistry } from './codec-lookup';
import { sqliteAdapterDescriptorMeta } from './descriptor-meta';

export type SqliteRuntimeAdapterInstance = RuntimeAdapterInstance<'sql', 'sqlite'> &
  ReturnType<typeof createSqliteAdapterWithCodecRegistry>;

function createSqliteMutationDefaultGenerators(): ReadonlyArray<RuntimeMutationDefaultGenerator> {
  return [
    ...builtinGeneratorIds.map(
      (id): RuntimeMutationDefaultGenerator => ({
        id,
        generate: (params?: Record<string, unknown>) => {
          const spec: GeneratedValueSpec = params ? { id, params } : { id };
          return generateId(spec);
        },
        stability: 'field',
      }),
    ),
    timestampNowRuntimeGenerator(),
  ];
}

const sqliteRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<
  'sqlite',
  SqliteRuntimeAdapterInstance
> = {
  ...sqliteAdapterDescriptorMeta,
  codecs: () => Array.from(sqliteCodecDescriptorRegistry.values()),
  mutationDefaultGenerators: createSqliteMutationDefaultGenerators,
  rawCodecInferer: sqliteRawCodecInferer,
  create(stack): SqliteRuntimeAdapterInstance {
    const codecRegistry = assembleSqliteCodecRegistry(stack.target, stack.extensions);
    return createSqliteAdapterWithCodecRegistry(codecRegistry);
  },
};

export default sqliteRuntimeAdapterDescriptor;
