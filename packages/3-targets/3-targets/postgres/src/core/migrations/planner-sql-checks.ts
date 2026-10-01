import type { CodecControlHooks } from '@internal/family-sql/control';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import { normalizeSchemaNativeType, withLengthOneWhenBare } from '../native-type-normalizer';
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

/** Each type `format_type` displays under another name: that name, and the words it writes after the type's modifier. */
const FORMAT_TYPE_DISPLAY: ReadonlyMap<string, { readonly name: string; readonly after: string }> =
  new Map([
    ['int2', { name: 'smallint', after: '' }],
    ['int4', { name: 'integer', after: '' }],
    ['int8', { name: 'bigint', after: '' }],
    ['float4', { name: 'real', after: '' }],
    ['float8', { name: 'double precision', after: '' }],
    ['bool', { name: 'boolean', after: '' }],
    ['timestamp', { name: 'timestamp', after: ' without time zone' }],
    ['timestamptz', { name: 'timestamp', after: ' with time zone' }],
    ['time', { name: 'time', after: ' without time zone' }],
    ['timetz', { name: 'time', after: ' with time zone' }],
  ]);

const TYPE_NAME_PARTS = /^([a-z][a-z0-9 ]*?)(\([^)]*\))?$/;

/** A type named as introspection reports it, as `format_type` displays it: `int4` as `integer`, and `timestamptz(3)` as `timestamp(3) with time zone`. */
function formatTypeDisplay(typeName: string): string {
  const parts = TYPE_NAME_PARTS.exec(typeName);
  const display = parts === null ? undefined : FORMAT_TYPE_DISPLAY.get(parts[1] ?? '');
  if (parts === null || display === undefined) return typeName;
  return `${display.name}${parts[2] ?? ''}${display.after}`;
}

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
      return formatTypeDisplay(
        normalizeSchemaNativeType(
          hooks.expandNativeType({
            nativeType: resolved.nativeType,
            codecId: resolved.codecId,
            typeParams: resolved.typeParams,
          }),
        ),
      );
    }
  }

  if (column.typeRef) {
    return formatUserDefinedTypeName(resolved.nativeType);
  }

  return formatTypeDisplay(withLengthOneWhenBare(normalizeSchemaNativeType(resolved.nativeType)));
}
