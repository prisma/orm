import { createMysqlRuntimeDriverDescriptor } from '@internal/driver-mysql/runtime';

/** The MariaDB runtime driver: MySQL's, whose drivers carry the MariaDB target id. */
const mariadbRuntimeDriverDescriptor = createMysqlRuntimeDriverDescriptor('mariadb');

export default mariadbRuntimeDriverDescriptor;
