import { createMysqlControlTargetDescriptor } from '@internal/target-mysql/control';
import { mariadbTargetDescriptorMeta } from '../descriptor-meta';

/** The facade module every MariaDB `migration.ts` imports from. */
const MARIADB_MIGRATION_MODULE = '@internal/mariadb/migration';

/** The MariaDB control target: MySQL's planner, runner, schema verifier and contract serializer under the MariaDB target id. */
const mariadbControlTargetDescriptor = createMysqlControlTargetDescriptor({
  descriptorMeta: mariadbTargetDescriptorMeta,
  migrationModule: MARIADB_MIGRATION_MODULE,
});

export default mariadbControlTargetDescriptor;
