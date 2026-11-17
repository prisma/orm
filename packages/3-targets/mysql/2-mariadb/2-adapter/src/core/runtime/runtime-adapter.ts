import { createMysqlRuntimeAdapterDescriptor } from '@internal/adapter-mysql/runtime';
import { mariadbAdapterDescriptorMeta } from '../descriptor-meta';
import { MariadbSqlRenderer } from '../sql-renderer';

/** The MariaDB runtime adapter: MySQL's, under the MariaDB target id, with MariaDB's capabilities and renderer. */
const mariadbRuntimeAdapterDescriptor = createMysqlRuntimeAdapterDescriptor({
  meta: mariadbAdapterDescriptorMeta,
  profileId: 'mariadb/default@1',
  renderer: (codecs) => new MariadbSqlRenderer(codecs),
});

export default mariadbRuntimeAdapterDescriptor;
