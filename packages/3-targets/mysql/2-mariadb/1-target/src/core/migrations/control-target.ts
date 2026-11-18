import { createMysqlControlTargetDescriptor } from '@internal/target-mysql/control';
import { mariadbTargetDescriptorMeta } from '../descriptor-meta';

/** The MariaDB control target: MySQL's planner, runner, schema verifier and contract serializer under the MariaDB target id. */
const mariadbControlTargetDescriptor = createMysqlControlTargetDescriptor({
  descriptorMeta: mariadbTargetDescriptorMeta,
});

export default mariadbControlTargetDescriptor;
