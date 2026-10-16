import type { GeneratedValueSpec } from '@internal/contract/types';
import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import { assembleDataTypes } from '@internal/framework-components/codec';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import type { RuntimeMutationDefaultGenerator } from '@internal/framework-components/runtime';
import { builtinGeneratorIds } from '@internal/ids';
import { generateId } from '@internal/ids/runtime';
import type { Adapter, AnyQueryAst } from '@internal/sql-relational-core/ast';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import {
  assemblePostgresCodecRegistry,
  postgresCodecRegistry,
} from '@internal/target-postgres/codecs';
import { postgresNowGenerators } from '@internal/target-postgres/runtime';
import { createPostgresAdapterWithCodecRegistry, postgresRawCodecInferer } from '../core/adapter';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement> {}

function createPostgresMutationDefaultGenerators(): ReadonlyArray<RuntimeMutationDefaultGenerator> {
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
    ...postgresNowGenerators.map(
      ({ id, generate }): RuntimeMutationDefaultGenerator => ({
        id,
        generate,
        stability: 'query',
      }),
    ),
  ];
}

const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: () => Array.from(postgresCodecRegistry.values()),
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    rawCodecInferer: postgresRawCodecInferer,
    create(stack): SqlRuntimeAdapter {
      const components = [stack.target, stack.adapter, ...stack.extensions];
      const dataTypeLookup = assembleDataTypes(components).lookup;
      const codecRegistry = assemblePostgresCodecRegistry(components, dataTypeLookup);
      return createPostgresAdapterWithCodecRegistry(codecRegistry, dataTypeLookup);
    },
  };

export default postgresRuntimeAdapterDescriptor;
