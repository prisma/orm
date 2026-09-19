import type { SqlControlAdapterDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { escapeLiteral, qualifyName, quoteIdentifier } from '@internal/target-postgres/sql-utils';
import { assemblePostgresCodecRegistry } from '../core/codec-lookup';
import { PostgresControlAdapter } from '../core/control-adapter';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresDefaultLiteralTagRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  postgresAuthoringTypes,
} from '../core/control-mutation-defaults';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  authoring: { type: postgresAuthoringTypes, valueObjectStorageType: 'Jsonb' },
  controlMutationDefaults: {
    defaultFunctionRegistry: createPostgresDefaultFunctionRegistry(),
    defaultLiteralTagRegistry: createPostgresDefaultLiteralTagRegistry(),
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

export { parsePostgresDefault } from '@internal/target-postgres/default-normalizer';
export { normalizeSchemaNativeType } from '@internal/target-postgres/native-type-normalizer';
export {
  createPostgresBuiltinCodecLookup,
  createPostgresCodecRegistryWithBuiltins,
} from '../core/codec-lookup';
export { PostgresControlAdapter } from '../core/control-adapter';
export { escapeLiteral, qualifyName, quoteIdentifier };
