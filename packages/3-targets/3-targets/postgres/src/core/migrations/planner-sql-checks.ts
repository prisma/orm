import type { CodecControlHooks } from '@internal/family-sql/control';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '../postgres-schema';
import { quoteIdentifier } from '../sql-utils';
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

const FORMAT_TYPE_DISPLAY: ReadonlyMap<string, string> = new Map([
  ['int2', 'smallint'],
  ['int4', 'integer'],
  ['int8', 'bigint'],
  ['float4', 'real'],
  ['float8', 'double precision'],
  ['bool', 'boolean'],
  ['timestamp', 'timestamp without time zone'],
  ['timestamptz', 'timestamp with time zone'],
  ['time', 'time without time zone'],
  ['timetz', 'time with time zone'],
  ['character', 'character(1)'],
  ['bit', 'bit(1)'],
]);

const UNQUOTED_POSTGRES_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_$]*$/;

const POSTGRES_RESERVED_IDENTIFIER_WORDS = new Set([
  'all',
  'analyse',
  'analyze',
  'and',
  'any',
  'array',
  'as',
  'asc',
  'asymmetric',
  'authorization',
  'between',
  'binary',
  'both',
  'case',
  'cast',
  'check',
  'collate',
  'column',
  'constraint',
  'create',
  'current_catalog',
  'current_date',
  'current_role',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'desc',
  'distinct',
  'do',
  'else',
  'end',
  'except',
  'false',
  'fetch',
  'for',
  'foreign',
  'freeze',
  'from',
  'full',
  'grant',
  'group',
  'having',
  'ilike',
  'in',
  'initially',
  'inner',
  'intersect',
  'into',
  'is',
  'isnull',
  'join',
  'lateral',
  'leading',
  'left',
  'like',
  'limit',
  'localtime',
  'localtimestamp',
  'natural',
  'not',
  'notnull',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'outer',
  'overlaps',
  'placing',
  'primary',
  'references',
  'right',
  'select',
  'session_user',
  'similar',
  'some',
  'symmetric',
  'table',
  'then',
  'to',
  'trailing',
  'true',
  'union',
  'unique',
  'user',
  'using',
  'variadic',
  'verbose',
  'when',
  'where',
  'window',
  'with',
]);

function formatUserDefinedTypeName(identifier: string): string {
  if (
    UNQUOTED_POSTGRES_IDENTIFIER_PATTERN.test(identifier) &&
    !POSTGRES_RESERVED_IDENTIFIER_WORDS.has(identifier)
  ) {
    return identifier;
  }

  return quoteIdentifier(identifier);
}

export function buildExpectedFormatType(
  column: StorageColumn,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);

  if (resolved.typeParams && resolved.codecId) {
    const hooks = codecHooks.get(resolved.codecId);
    if (hooks?.expandNativeType) {
      return hooks.expandNativeType({
        nativeType: resolved.nativeType,
        codecId: resolved.codecId,
        typeParams: resolved.typeParams,
      });
    }
  }

  if (column.typeRef) {
    return formatUserDefinedTypeName(resolved.nativeType);
  }

  return FORMAT_TYPE_DISPLAY.get(resolved.nativeType) ?? resolved.nativeType;
}
