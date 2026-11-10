import { createMysqlControlDriverDescriptor } from '@internal/driver-mysql/control';

/** The MariaDB control driver: MySQL's, whose drivers carry the MariaDB target id. */
const mariadbControlDriverDescriptor = createMysqlControlDriverDescriptor('mariadb');

export default mariadbControlDriverDescriptor;
