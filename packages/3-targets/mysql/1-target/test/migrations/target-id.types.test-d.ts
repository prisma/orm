import type { SqlControlTargetDescriptor } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { expectTypeOf, test } from 'vitest';
import { mysqlTargetDescriptorMeta } from '../../src/core/descriptor-meta';
import mysqlControlTarget, {
  createMysqlControlTargetDescriptor,
} from '../../src/core/migrations/control-target';
import { type MysqlMigration, MysqlMigrationBase } from '../../src/core/migrations/mysql-migration';
import {
  createMysqlMigrationPlanner,
  type MysqlMigrationPlanner,
} from '../../src/core/migrations/planner';
import type { TypeScriptRenderableMysqlMigration } from '../../src/core/migrations/planner-produced-mysql-migration';
import type { MysqlPlanTargetDetails } from '../../src/core/migrations/planner-target-details';

declare const lowerer: ExecuteRequestLowerer;

test('the control target factory keeps the target id of the meta it is given', () => {
  const mariadb = createMysqlControlTargetDescriptor({
    descriptorMeta: { ...mysqlTargetDescriptorMeta, targetId: 'mariadb', id: 'mariadb' },
    migrationModule: '@internal/mariadb/migration',
  });
  expectTypeOf(mariadb).toEqualTypeOf<
    SqlControlTargetDescriptor<'mariadb', MysqlPlanTargetDetails>
  >();
  expectTypeOf(mysqlControlTarget).toEqualTypeOf<
    SqlControlTargetDescriptor<'mysql', MysqlPlanTargetDetails>
  >();
});

test('the planner and its plans carry the target id they are given, and MySQL by default', () => {
  const mariadb = createMysqlMigrationPlanner(lowerer, {
    targetId: 'mariadb',
    migrationModule: '@internal/mariadb/migration',
  });
  expectTypeOf(mariadb).toEqualTypeOf<MysqlMigrationPlanner<'mariadb'>>();
  expectTypeOf(createMysqlMigrationPlanner(lowerer)).toEqualTypeOf<
    MysqlMigrationPlanner<'mysql'>
  >();
  expectTypeOf(mariadb.emptyMigration).returns.toEqualTypeOf<
    TypeScriptRenderableMysqlMigration<'mariadb'>
  >();
  expectTypeOf<
    TypeScriptRenderableMysqlMigration<'mariadb'>['targetId']
  >().toEqualTypeOf<'mariadb'>();
});

test('a migration class built on the MySQL base carries its own target id', () => {
  abstract class MariadbMigration extends MysqlMigrationBase<'mariadb'> {
    readonly targetId = 'mariadb' as const;
  }
  expectTypeOf<MariadbMigration['targetId']>().toEqualTypeOf<'mariadb'>();
  expectTypeOf<MysqlMigration['targetId']>().toEqualTypeOf<'mysql'>();
});
