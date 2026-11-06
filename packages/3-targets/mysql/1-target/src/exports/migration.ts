export { MigrationCLI } from '@internal/cli/migration-cli';
export { placeholder } from '@internal/errors/migration';
export { sql } from '@internal/sql-contract/sql-expression';
export { col, fn, lit, primaryKey, unique } from '@internal/sql-relational-core/contract-free';
export { MysqlMigration as Migration } from '../core/migrations/mysql-migration';
export {
  AddColumnCall,
  AddForeignKeyCall,
  AddUniqueCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropForeignKeyCall,
  DropIndexCall,
  DropTableCall,
  DropUniqueCall,
  type MysqlOpFactoryCall,
  RawSqlCall,
} from '../core/migrations/op-factory-call';
export { rawSql } from '../core/migrations/operations';
export {
  createMysqlMigrationPlanner,
  MysqlMigrationPlanner,
  type MysqlPlanResult,
} from '../core/migrations/planner';
export {
  type MysqlMigrationDestinationInfo,
  TypeScriptRenderableMysqlMigration,
} from '../core/migrations/planner-produced-mysql-migration';
export { createMysqlMigrationRunner } from '../core/migrations/runner';
