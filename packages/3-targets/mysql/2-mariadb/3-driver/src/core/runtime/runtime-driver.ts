import { createMysqlRuntimeDriverDescriptor } from '@internal/driver-mysql/runtime';
import { mariadbTargetDescriptorMetaRuntime } from '@internal/target-mariadb/descriptor-meta-runtime';

/** The MariaDB runtime driver: MySQL's, under the target MariaDB's runtime metadata names. */
const mariadbRuntimeDriverDescriptor = createMysqlRuntimeDriverDescriptor({
  target: mariadbTargetDescriptorMetaRuntime,
});

export default mariadbRuntimeDriverDescriptor;
