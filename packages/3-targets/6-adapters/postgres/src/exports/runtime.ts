import type { GeneratedValueSpec } from '@internal/contract/types';
import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import { builtinGeneratorIds } from '@internal/ids';
import { generateId } from '@internal/ids/runtime';
import type { Adapter, AnyQueryAst } from '@internal/sql-relational-core/ast';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import { postgresCodecRegistry } from '@internal/target-postgres/codecs';
import { INSTANT_NOW_GENERATOR_ID, instantNow } from '@internal/target-postgres/runtime';
import { createPostgresAdapterWithCodecRegistry, postgresRawCodecInferer } from '../core/adapter';
import { assemblePostgresCodecRegistry } from '../core/codec-lookup';
import { postgresAdapterDescriptorMeta, postgresQueryOperations } from '../core/descriptor-meta';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement> {}

function createPostgresMutationDefaultGenerators() {
  return [
    ...builtinGeneratorIds.map((id) => ({
      id,
      generate: (params?: Record<string, unknown>) => {
        const spec: GeneratedValueSpec = params ? { id, params } : { id };
        return generateId(spec);
      },
      stability: 'field' as const,
    })),
    timestampNowRuntimeGenerator(),
    // The Temporal-backed sibling. `stability: 'query'` for the same reason `timestampNow` has it:
    // one instant across every row and every temporal-defaulted column of one ORM operation.
    {
      id: INSTANT_NOW_GENERATOR_ID,
      generate: () => instantNow(),
      stability: 'query' as const,
    },
  ];
}

const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: () => Array.from(postgresCodecRegistry.values()),
    queryOperations: () => postgresQueryOperations(),
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    rawCodecInferer: postgresRawCodecInferer,
    create(stack): SqlRuntimeAdapter {
      const components = [stack.target, stack.adapter, ...stack.extensions];
      const codecRegistry = assemblePostgresCodecRegistry(components);
      return createPostgresAdapterWithCodecRegistry(codecRegistry);
    },
  };

export default postgresRuntimeAdapterDescriptor;
