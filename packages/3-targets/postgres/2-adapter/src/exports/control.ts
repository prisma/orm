import type { SqlControlAdapterDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { assemblePostgresCodecRegistry } from '@internal/target-postgres/codecs';
import { escapeLiteral, qualifyName, quoteIdentifier } from '@internal/target-postgres/sql-utils';
import { PostgresControlAdapter } from '../core/control-adapter';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import { createPostgresDefaultFunctionRegistry } from '../core/migrations/control-mutation-defaults';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  authoring: {
    valueObjectStorageType: 'Jsonb',
  },
  controlMutationDefaults: {
    defaultFunctionRegistry: createPostgresDefaultFunctionRegistry(),
    generatorDescriptors: [],
  },
  create(stack): SqlControlAdapter<'postgres'> {
    const components = [
      stack.target,
      ...(stack.adapter === undefined ? [] : [stack.adapter]),
      ...stack.extensions,
    ];
    const codecRegistry = assemblePostgresCodecRegistry(components, stack.dataTypes.lookup);
    return new PostgresControlAdapter(
      codecRegistry,
      stack.dataTypes.lookup,
      stack.declaredDataTypes.map(({ type }) => type),
    );
  },
};

export default postgresAdapterDescriptor;

export {
  createPostgresBuiltinCodecLookup,
  createPostgresCodecRegistryWithBuiltins,
} from '@internal/target-postgres/codecs';
export { PostgresControlAdapter } from '../core/control-adapter';
export { escapeLiteral, qualifyName, quoteIdentifier };
