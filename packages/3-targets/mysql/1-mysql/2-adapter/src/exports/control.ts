import {
  type SqlControlAdapterDescriptor,
  sqlDefaultFunctions,
} from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { mysqlAdapterDescriptorMeta } from '../core/descriptor-meta';
import { createMysqlControlAdapter } from '../core/migrations/control-adapter';
import { readMysqlCatalog } from '../core/migrations/introspection-queries';

const mysqlAdapterDescriptor: SqlControlAdapterDescriptor<'mysql'> = {
  ...mysqlAdapterDescriptorMeta,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(Object.entries(sqlDefaultFunctions())),
    generatorDescriptors: [],
  },
  create(stack): SqlControlAdapter<'mysql'> {
    return createMysqlControlAdapter(stack, { readCatalog: readMysqlCatalog });
  },
};

export default mysqlAdapterDescriptor;

export {
  createMysqlControlAdapter,
  type MysqlCatalogReader,
  type MysqlControlAdapterOptions,
} from '../core/migrations/control-adapter';
export {
  buildMysqlSchemaIR,
  type MysqlCatalogRows,
  type MysqlColumnRow,
} from '../core/migrations/introspection';
export {
  MYSQL_CATALOG_QUERIES,
  type MysqlCatalogQueries,
  readMysqlCatalog,
} from '../core/migrations/introspection-queries';
