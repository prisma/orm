import type { SqlControlAdapterDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { assemblePostgresCodecRegistry } from '@internal/target-postgres/codecs';
import { escapeLiteral, qualifyName, quoteIdentifier } from '@internal/target-postgres/sql-utils';
import { PostgresControlAdapter } from '../core/control-adapter';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  postgresAuthoringTypes,
} from '../core/control-mutation-defaults';
import { createPostgresDataTypeEntries } from '../core/data-type-authoring';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  authoring: {
    type: postgresAuthoringTypes,
    dataTypes: createPostgresDataTypeEntries(),
    valueObjectStorageType: 'Jsonb',
  },
  controlMutationDefaults: {
    defaultFunctionRegistry: createPostgresDefaultFunctionRegistry(),
    generatorDescriptors: createPostgresMutationDefaultGeneratorDescriptors(),
  },
  create(stack): SqlControlAdapter<'postgres'> {
    const components = [
      stack.target,
      ...(stack.adapter === undefined ? [] : [stack.adapter]),
      ...stack.extensions,
    ];
    const codecRegistry = assemblePostgresCodecRegistry(components);
    return new PostgresControlAdapter(codecRegistry);
  },
};

export default postgresAdapterDescriptor;

export {
  createPostgresBuiltinCodecLookup,
  createPostgresCodecRegistryWithBuiltins,
} from '@internal/target-postgres/codecs';
export { parsePostgresDefault } from '@internal/target-postgres/default-normalizer';
export { normalizeSchemaNativeType } from '@internal/target-postgres/native-type-normalizer';
export { PostgresControlAdapter } from '../core/control-adapter';
export { escapeLiteral, qualifyName, quoteIdentifier };
