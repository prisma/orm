import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { DdlNode } from '@internal/sql-relational-core/ast';
import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { SQLITE_NOW_EXPRESSION } from '../core/codecs';
import { createTable } from './ddl';

const markerColumns = [
  col('space', 'TEXT', { notNull: true, primaryKey: true, default: lit(APP_SPACE_ID) }),
  col('core_hash', 'TEXT', { notNull: true }),
  col('profile_hash', 'TEXT', { notNull: true }),
  col('contract_json', 'TEXT'),
  col('canonical_version', 'INTEGER'),
  col('updated_at', 'TEXT', { notNull: true, default: fn(SQLITE_NOW_EXPRESSION) }),
  col('app_tag', 'TEXT'),
  col('meta', 'TEXT', { notNull: true, default: lit('{}') }),
  col('invariants', 'TEXT', { notNull: true, default: lit('[]') }),
] as const;

const ledgerColumns = [
  col('id', 'INTEGER PRIMARY KEY AUTOINCREMENT'),
  col('created_at', 'TEXT', {
    notNull: true,
    default: fn(SQLITE_NOW_EXPRESSION),
  }),
  col('space', 'TEXT', { notNull: true }),
  col('migration_name', 'TEXT', { notNull: true }),
  col('migration_hash', 'TEXT', { notNull: true }),
  col('origin_core_hash', 'TEXT'),
  col('origin_profile_hash', 'TEXT'),
  col('destination_core_hash', 'TEXT', { notNull: true }),
  col('destination_profile_hash', 'TEXT'),
  col('contract_json_before', 'TEXT'),
  col('contract_json_after', 'TEXT'),
  col('operations', 'TEXT', { notNull: true }),
] as const;

const markerTable = createTable({
  table: '_prisma_marker',
  ifNotExists: true,
  columns: markerColumns,
});

const ledgerTable = createTable({
  table: '_prisma_ledger',
  ifNotExists: true,
  columns: ledgerColumns,
});

export function buildSignMarkerBootstrapQueries(): readonly DdlNode[] {
  return [markerTable];
}

export function buildControlTableBootstrapQueries(): readonly DdlNode[] {
  return [markerTable, ledgerTable];
}
