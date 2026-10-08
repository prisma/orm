import type { SqlControlAdapterDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { assemblePostgresCodecRegistry } from '@internal/target-postgres/codecs';
import { postgresPslTypeConstructors } from '@internal/target-postgres/control';
import { escapeLiteral, qualifyName, quoteIdentifier } from '@internal/target-postgres/sql-utils';
import { PostgresControlAdapter } from '../core/control-adapter';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
} from '../core/control-mutation-defaults';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  authoring: {
    type: postgresPslTypeConstructors,
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
    const codecRegistry = assemblePostgresCodecRegistry(components, stack.dataTypes.lookup);
    return new PostgresControlAdapter(codecRegistry, stack.dataTypes.lookup);
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
