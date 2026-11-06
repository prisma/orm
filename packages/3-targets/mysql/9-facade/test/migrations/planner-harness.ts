import mysqlAdapter from '@internal/adapter-mysql/control';
import type { Contract } from '@internal/contract/types';
import mysqlDriver from '@internal/driver-mysql/control';
import sql, { type SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import {
  createControlStack,
  type MigrationOperationPolicy,
  type MigrationPlan,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import mysql, { type MysqlPlanTargetDetails } from '@internal/target-mysql/control';
import type { MysqlPlanResult } from '@internal/target-mysql/migration';
import { createMysqlMigrationPlanner } from '@internal/target-mysql/migration';
import { blindCast } from '@internal/utils/casts';
import { frameworkComponents } from '../example-contract';

export const controlStack = createControlStack({
  family: sql,
  target: mysql,
  adapter: mysqlAdapter,
  driver: mysqlDriver,
});

export function createAdapter(): SqlControlAdapter<'mysql'> {
  return mysqlAdapter.create(controlStack);
}

export const ADDITIVE: MigrationOperationPolicy = { allowedOperationClasses: ['additive'] };
export const EVERY_CLASS: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

/** Plans `contract` against the schema `from` describes, as `migration plan` does offline. */
export function planFrom(
  from: Contract<SqlStorage> | null,
  contract: Contract<SqlStorage>,
  policy: MigrationOperationPolicy = EVERY_CLASS,
): MysqlPlanResult {
  return createMysqlMigrationPlanner(createAdapter()).plan({
    contract,
    schema: mysql.migrations.contractToSchema(from, frameworkComponents),
    policy,
    fromContract: from,
    origin: from === null ? null : { storageHash: from.storage.storageHash },
    statements: [],
    frameworkComponents,
    spaceId: 'app',
    snapshotsImportPath: '../../snapshots',
  });
}

/** Each operation of a plan as its id and the SQL it runs. */
export async function operationSql(plan: MigrationPlan) {
  const operations = blindCast<
    readonly SqlMigrationPlanOperation<MysqlPlanTargetDetails>[],
    'the MySQL planner produces MySQL operations'
  >(await Promise.all(plan.operations));
  return operations.map((operation) => ({
    id: operation.id,
    sql: operation.execute.map((step) => step.sql),
  }));
}

/** Each operation of a successful plan as its id and the SQL it runs. */
export function executedSql(result: MysqlPlanResult) {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return operationSql(result.plan);
}
