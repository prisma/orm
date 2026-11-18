import { createMysqlRuntimeAdapterDescriptor } from '@internal/adapter-mysql/runtime';
import { mariadbTargetDescriptorMetaRuntime } from '@internal/target-mariadb/descriptor-meta-runtime';
import { mariadbAdapterDescriptorMeta } from '../descriptor-meta';
import { MariadbSqlRenderer } from '../sql-renderer';

/** The MariaDB runtime adapter: MySQL's, with MariaDB's capabilities and renderer, under the target MariaDB's runtime metadata names. */
const mariadbRuntimeAdapterDescriptor = createMysqlRuntimeAdapterDescriptor({
  descriptorMeta: mariadbAdapterDescriptorMeta,
  target: mariadbTargetDescriptorMetaRuntime,
  renderer: (codecs, target) => new MariadbSqlRenderer(codecs, target),
});

export default mariadbRuntimeAdapterDescriptor;
