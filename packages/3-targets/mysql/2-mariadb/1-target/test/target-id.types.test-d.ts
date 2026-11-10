import type { SqlControlTargetDescriptor } from '@internal/family-sql/control';
import type { MysqlPlanTargetDetails } from '@internal/target-mysql/control';
import { expectTypeOf, test } from 'vitest';
import { mariadbTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mariadbControlTarget from '../src/core/migrations/control-target';
import type { MariadbMigration } from '../src/core/migrations/mariadb-migration';

test('the MariaDB pack, control target and migration class carry the MariaDB target id', () => {
  expectTypeOf(mariadbTargetDescriptorMeta.targetId).toEqualTypeOf<'mariadb'>();
  expectTypeOf(mariadbTargetDescriptorMeta.id).toEqualTypeOf<'mariadb'>();
  expectTypeOf(mariadbControlTarget).toEqualTypeOf<
    SqlControlTargetDescriptor<'mariadb', MysqlPlanTargetDetails>
  >();
  expectTypeOf<MariadbMigration['targetId']>().toEqualTypeOf<'mariadb'>();
});
