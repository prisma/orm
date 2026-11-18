import { createMysqlRuntimeDriverDescriptor } from '@internal/driver-mysql/runtime';
import { mariadbTargetDescriptorMetaRuntime } from '@internal/target-mariadb/descriptor-meta-runtime';
import { MARIADB_CHECK_VIOLATION_ERRORS } from '../check-violation-errors';

/** The MariaDB runtime driver: MySQL's, under the target MariaDB's runtime metadata names, reporting MariaDB's CHECK errors. */
const mariadbRuntimeDriverDescriptor = createMysqlRuntimeDriverDescriptor({
  target: mariadbTargetDescriptorMetaRuntime,
  checkViolationErrors: MARIADB_CHECK_VIOLATION_ERRORS,
});

export default mariadbRuntimeDriverDescriptor;
