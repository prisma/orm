import { createMysqlRuntimeTargetDescriptor } from '@internal/target-mysql/runtime';
import { mariadbTargetDescriptorMetaRuntime } from '../descriptor-meta';

/** The MariaDB runtime target: MySQL's, under the MariaDB target id. */
const mariadbRuntimeTargetDescriptor = createMysqlRuntimeTargetDescriptor(
  mariadbTargetDescriptorMetaRuntime,
);

export default mariadbRuntimeTargetDescriptor;
