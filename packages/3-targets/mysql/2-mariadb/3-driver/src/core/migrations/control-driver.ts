import { createMysqlControlDriverDescriptor } from '@internal/driver-mysql/control';
import { mariadbTargetDescriptorMetaRuntime } from '@internal/target-mariadb/descriptor-meta-runtime';
import { MARIADB_CHECK_VIOLATION_ERRORS } from '../check-violation-errors';

/** The MariaDB control driver: MySQL's, under the target MariaDB's runtime metadata names, reporting MariaDB's CHECK errors. */
const mariadbControlDriverDescriptor = createMysqlControlDriverDescriptor({
  target: mariadbTargetDescriptorMetaRuntime,
  checkViolationErrors: MARIADB_CHECK_VIOLATION_ERRORS,
});

export default mariadbControlDriverDescriptor;
