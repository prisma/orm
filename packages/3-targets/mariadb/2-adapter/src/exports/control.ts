import { createMysqlControlAdapter } from '@internal/adapter-mysql/control';
import {
  type SqlControlAdapterDescriptor,
  sqlDefaultFunctions,
} from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { mariadbAdapterDescriptorMeta } from '../core/descriptor-meta';
import { readMariadbCatalog } from '../core/migrations/catalog';

const mariadbAdapterDescriptor: SqlControlAdapterDescriptor<'mariadb'> = {
  ...mariadbAdapterDescriptorMeta,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(Object.entries(sqlDefaultFunctions())),
    generatorDescriptors: [],
  },
  create(stack): SqlControlAdapter<'mariadb'> {
    return createMysqlControlAdapter(stack, { readCatalog: readMariadbCatalog });
  },
};

export default mariadbAdapterDescriptor;
