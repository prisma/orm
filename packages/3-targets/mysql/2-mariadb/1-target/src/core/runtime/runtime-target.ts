import { createMysqlRuntimeTargetDescriptor } from '@internal/target-mysql/runtime';
import { mariadbTargetDescriptorMetaRuntime } from '../descriptor-meta-runtime';

/** The MariaDB runtime target: MySQL's, built from MariaDB's runtime metadata. */
const mariadbRuntimeTargetDescriptor = createMysqlRuntimeTargetDescriptor({
  descriptorMeta: mariadbTargetDescriptorMetaRuntime,
});

export default mariadbRuntimeTargetDescriptor;
