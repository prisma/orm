import { APP_SPACE_ID } from '@internal/framework-components/control';
import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { LEDGER_TABLE_NAME, MARKER_TABLE_NAME } from '../core/control-tables';
import type { MysqlDdlNode } from '../core/ddl/nodes';
import { createTable } from './ddl';

const NOW = fn('CURRENT_TIMESTAMP(3)');

const markerTable = createTable({
  table: MARKER_TABLE_NAME,
  ifNotExists: true,
  columns: [
    col('space', 'varchar(191)', { notNull: true, primaryKey: true, default: lit(APP_SPACE_ID) }),
    col('core_hash', 'varchar(191)', { notNull: true }),
    col('profile_hash', 'varchar(191)', { notNull: true }),
    col('contract_json', 'longtext'),
    col('canonical_version', 'int'),
    col('updated_at', 'datetime(3)', { notNull: true, default: NOW }),
    col('app_tag', 'text'),
    col('meta', 'text', { notNull: true, default: fn("'{}'") }),
    col('invariants', 'text', { notNull: true, default: fn("'[]'") }),
  ],
});

const ledgerTable = createTable({
  table: LEDGER_TABLE_NAME,
  ifNotExists: true,
  columns: [
    col('id', 'bigint', { notNull: true, primaryKey: true, default: fn('autoincrement()') }),
    col('created_at', 'datetime(3)', { notNull: true, default: NOW }),
    col('space', 'varchar(191)', { notNull: true }),
    col('migration_name', 'text', { notNull: true }),
    col('migration_hash', 'varchar(191)', { notNull: true }),
    col('origin_core_hash', 'varchar(191)'),
    col('origin_profile_hash', 'varchar(191)'),
    col('destination_core_hash', 'varchar(191)', { notNull: true }),
    col('destination_profile_hash', 'varchar(191)'),
    col('contract_json_before', 'longtext'),
    col('contract_json_after', 'longtext'),
    col('operations', 'longtext', { notNull: true }),
  ],
});

/** The DDL that creates the marker table `db sign` writes, when it does not exist. */
export function buildSignMarkerBootstrapQueries(): readonly MysqlDdlNode[] {
  return [markerTable];
}

/** The DDL that creates the marker and ledger tables the migration runner writes, when they do not exist. */
export function buildControlTableBootstrapQueries(): readonly MysqlDdlNode[] {
  return [markerTable, ledgerTable];
}
