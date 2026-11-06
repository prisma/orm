import {
  type SqlControlAdapterDescriptor,
  sqlDefaultFunctions,
} from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { assembleMysqlCodecRegistry } from '@internal/target-mysql/codecs';
import { mysqlAdapterDescriptorMeta } from '../core/descriptor-meta';
import { MysqlControlAdapter } from '../core/migrations/control-adapter';

const mysqlAdapterDescriptor: SqlControlAdapterDescriptor<'mysql'> = {
  ...mysqlAdapterDescriptorMeta,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(Object.entries(sqlDefaultFunctions())),
    generatorDescriptors: [],
  },
  create(stack): SqlControlAdapter<'mysql'> {
    return new MysqlControlAdapter(
      assembleMysqlCodecRegistry(stack.target, stack.extensions),
      stack.declaredDataTypes.map(({ type }) => type),
    );
  },
};

export default mysqlAdapterDescriptor;

export { MysqlControlAdapter } from '../core/migrations/control-adapter';
export { buildMysqlSchemaIR, type MysqlCatalogRows } from '../core/migrations/introspection';
