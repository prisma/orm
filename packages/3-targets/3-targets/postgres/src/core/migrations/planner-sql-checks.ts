import {
  dataTypeParams,
  renderSqlCatalogText,
  type SqlTypeLookups,
  sqlDataTypeOfCodec,
  unquotedSqlBaseName,
} from '@internal/sql-contract/data-type';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '../postgres-schema';
import { quoteIdentifierWhereNeeded } from '../sql-utils';
import { resolveColumnTypeMetadata } from './planner-type-resolution';

/**
 * String-keyed entry points the migration ops use to render
 * schema-qualified DDL and catalog checks. The `schema` argument is
 * interpreted as a namespace coordinate: the framework `__unbound__`
 * sentinel resolves to the late-bound `PostgresUnboundSchema` singleton
 * (which elides the qualifier so `search_path` decides at runtime); any
 * other id materialises a `PostgresSchema(id)` whose qualifier is the
 * named schema. Helpers route through these `Namespace` concretions so
 * the unbound branch lives in the polymorphic override, not the call
 * site.
 */
export function qualifyTableName(schema: string, table: string): string {
  return postgresCreateNamespace({ id: schema, entries: { table: {} } }).qualifyTable(table);
}

/**
 * The type `format_type` prints, for the column's ALTER COLUMN TYPE postcheck: the catalog text of
 * its data type with normalised parameters, or for an enum its name, quoted where Postgres quotes
 * it.
 */
export function buildExpectedFormatType(
  column: StorageColumn,
  types: SqlTypeLookups,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  const dataType = sqlDataTypeOfCodec(resolved.codecId, types);
  const params = dataTypeParams(dataType, resolved.typeParams);
  if (dataType.sql.claimsKind !== undefined) {
    return unquotedSqlBaseName(dataType, params)
      .split('.')
      .map(quoteIdentifierWhereNeeded)
      .join('.');
  }
  return renderSqlCatalogText(dataType, params);
}
