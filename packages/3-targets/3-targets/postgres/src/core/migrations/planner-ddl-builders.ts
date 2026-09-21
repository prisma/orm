import type { CodecControlHooks } from '@internal/family-sql/control';
import { checkSqlDefaultBody } from '@internal/family-sql/control';
import type { StorageColumn, StorageTypeInstance } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { isPgEnumParams } from '../codecs';
import { postgresError } from '../errors';
import { escapeLiteral, quoteIdentifier, quoteQualifiedName } from '../sql-utils';
import type { PostgresColumnDefault } from '../types';
import { resolveColumnTypeMetadata } from './planner-type-resolution';

/**
 * Pattern for safe PostgreSQL type names.
 * Allows letters, digits, underscores, spaces (for "double precision", "character varying"),
 * and trailing [] for array types.
 */
const SAFE_NATIVE_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_ ]*(\[\])?$/;

function assertSafeNativeType(nativeType: string): void {
  if (!SAFE_NATIVE_TYPE_PATTERN.test(nativeType)) {
    throw postgresError(
      'CONTRACT.NATIVE_TYPE_INVALID',
      `Unsafe native type name in contract: "${nativeType}". ` +
        'Native type names must match /^[a-zA-Z][a-zA-Z0-9_ ]*(\\[\\])?$/',
      { meta: { nativeType } },
    );
  }
}

/**
 * Sanity check against accidental SQL injection from malformed contract files.
 * Rejects semicolons, SQL comment tokens, and dollar-quoting.
 * Not a comprehensive security boundary — the contract is developer-authored.
 */
function assertSafeDefaultExpression(expression: string): void {
  if (checkSqlDefaultBody(expression) !== undefined) {
    throw postgresError(
      'CONTRACT.DEFAULT_INVALID',
      `Unsafe default expression in contract: "${expression}". ` +
        'Default expressions must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
      { meta: { expression } },
    );
  }
}

/**
 * Renders the SQL type for a column in DDL context.
 *
 * @param allowPseudoTypes - When true (default), autoincrement integer columns
 *   produce SERIAL/BIGSERIAL/SMALLSERIAL pseudo-types. Set to false for contexts
 *   like ALTER COLUMN TYPE where pseudo-types are invalid.
 */
export function buildColumnTypeSql(
  column: Pick<
    StorageColumn,
    'nativeType' | 'codecId' | 'many' | 'typeParams' | 'typeRef' | 'default'
  >,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance> = {},
  allowPseudoTypes = true,
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);

  if (allowPseudoTypes) {
    const columnDefault = column.default;
    if (columnDefault?.kind === 'function' && columnDefault.expression === 'autoincrement()') {
      if (resolved.nativeType === 'int4' || resolved.nativeType === 'integer') {
        return 'SERIAL';
      }
      if (resolved.nativeType === 'int8' || resolved.nativeType === 'bigint') {
        return 'BIGSERIAL';
      }
      if (resolved.nativeType === 'int2' || resolved.nativeType === 'smallint') {
        return 'SMALLSERIAL';
      }
    }
  }

  // A column whose codec supplied a `typeParams.typeName` references a named
  // database type (e.g. a native enum), not a parameterized builtin: render it
  // as its quoted, schema-qualified type-name identifier. DDL-render only — the
  // verify comparison value (`resolvedNativeType`) stays the bare name the
  // family expander produces, matching introspection.
  if (isPgEnumParams(resolved.typeParams)) {
    const quoted = quoteQualifiedName(resolved.nativeType);
    return column.many ? `${quoted}[]` : quoted;
  }

  const expanded = expandParameterizedTypeSql(resolved, codecHooks);
  if (expanded !== null) {
    return column.many ? `${expanded}[]` : expanded;
  }

  if (column.typeRef) {
    const base = quoteQualifiedName(resolved.nativeType);
    return column.many ? `${base}[]` : base;
  }

  assertSafeNativeType(resolved.nativeType);
  return column.many ? `${resolved.nativeType}[]` : resolved.nativeType;
}

function expandParameterizedTypeSql(
  column: Pick<StorageColumn, 'nativeType' | 'codecId' | 'typeParams'>,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): string | null {
  if (!column.typeParams || Object.keys(column.typeParams).length === 0) {
    return null;
  }

  if (!column.codecId) {
    throw postgresError(
      'CONTRACT.CODEC_DESCRIPTOR_MISSING',
      `Column declares typeParams for nativeType "${column.nativeType}" but has no codecId. ` +
        'Ensure the column is associated with a codec.',
      { meta: { nativeType: column.nativeType } },
    );
  }

  const hooks = codecHooks.get(column.codecId);
  if (!hooks?.expandNativeType) {
    if (hooks?.planTypeOperations) {
      return null;
    }
    throw postgresError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Column declares typeParams for nativeType "${column.nativeType}" ` +
        `but no expandNativeType hook is registered for codecId "${column.codecId}". ` +
        'Ensure the extension providing this codec is included in extensions.',
      { meta: { codecId: column.codecId, nativeType: column.nativeType } },
    );
  }

  const expanded = hooks.expandNativeType({
    nativeType: column.nativeType,
    codecId: column.codecId,
    ...ifDefined('typeParams', column.typeParams),
  });

  return expanded !== column.nativeType ? expanded : null;
}

/** Autoincrement columns use SERIAL types, so this returns empty for them. */
export function buildColumnDefaultSql(
  columnDefault: PostgresColumnDefault | undefined,
  column?: Pick<StorageColumn, 'many' | 'nativeType'>,
): string {
  if (!columnDefault) {
    return '';
  }

  switch (columnDefault.kind) {
    case 'literal':
      return `DEFAULT ${renderDefaultLiteral(columnDefault.value, column)}`;
    case 'function': {
      if (columnDefault.expression === 'autoincrement()') {
        return '';
      }
      assertSafeDefaultExpression(columnDefault.expression);
      return `DEFAULT (${columnDefault.expression})`;
    }
    case 'sequence':
      return `DEFAULT nextval('${escapeLiteral(quoteIdentifier(columnDefault.name))}'::regclass)`;
  }
}

export function renderDefaultLiteral(
  value: unknown,
  column?: Pick<StorageColumn, 'many' | 'nativeType'>,
): string {
  const isJsonColumn = column?.nativeType === 'json' || column?.nativeType === 'jsonb';

  if (column?.many && Array.isArray(value)) {
    return renderArrayLiteralDefault(value, column.nativeType);
  }

  if (value instanceof Date) {
    return `'${escapeLiteral(value.toISOString())}'`;
  }
  if (typeof value === 'string') {
    return `'${escapeLiteral(value)}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'NULL';
  }
  const json = JSON.stringify(value);
  if (isJsonColumn) {
    return `'${escapeLiteral(json)}'::${column.nativeType}`;
  }
  return `'${escapeLiteral(json)}'`;
}

/**
 * An `ARRAY[...]` of quoted elements has type `text[]`, which Postgres does not assign to a list of
 * numbers, decimals, timestamps or enums, so the constructor is cast to the list type. Each element
 * is the text Postgres reads for its type: an `int8` or `numeric` value as decimal text, a temporal
 * value as ISO text. `nativeType` is the element type or the list type, written as SQL, so a
 * user-defined type name arrives already quoted.
 */
function renderArrayLiteralDefault(elements: unknown[], nativeType: string): string {
  if (elements.length === 0) {
    return "'{}'";
  }
  const rendered = `ARRAY[${elements.map((el) => renderDefaultLiteral(el)).join(', ')}]`;
  if (nativeType === '') return rendered;
  return `${rendered}::${nativeType.endsWith('[]') ? nativeType : `${nativeType}[]`}`;
}
