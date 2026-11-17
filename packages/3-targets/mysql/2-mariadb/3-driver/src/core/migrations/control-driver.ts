import { createMysqlControlDriverDescriptor } from '@internal/driver-mysql/control';
import { mariadbTargetDescriptorMetaRuntime } from '@internal/target-mariadb/descriptor-meta-runtime';

/** The MariaDB control driver: MySQL's, under the target MariaDB's runtime metadata names. */
const mariadbControlDriverDescriptor = createMysqlControlDriverDescriptor({
  target: mariadbTargetDescriptorMetaRuntime,
});

export default mariadbControlDriverDescriptor;
