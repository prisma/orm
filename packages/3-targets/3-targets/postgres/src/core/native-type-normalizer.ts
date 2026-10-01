/**
 * Postgres native-type normalization.
 *
 * Lives in `target-postgres` because both the migration planner/runner (control
 * plane) and the introspection adapter (control plane) need to normalize raw
 * native-type strings to the same canonical form for comparison.
 */

/** PostgreSQL's other names for a type, each with the name introspection reports it under. */
const TYPE_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  ['char', 'character'],
  ['bpchar', 'character'],
  ['varchar', 'character varying'],
  ['varbit', 'bit varying'],
  ['int', 'int4'],
  ['integer', 'int4'],
  ['smallint', 'int2'],
  ['bigint', 'int8'],
  ['real', 'float4'],
  ['double precision', 'float8'],
  ['float', 'float8'],
  ['boolean', 'bool'],
  ['decimal', 'numeric'],
]);

/** The types that take ` with time zone`, each with the name it has with one. */
const WITH_TIME_ZONE: ReadonlyMap<string, string> = new Map([
  ['timestamp', 'timestamptz'],
  ['time', 'timetz'],
]);

const NATIVE_TYPE_PARTS = /^([a-z][a-z ]*?)(\([^)]*\))?( with time zone| without time zone)?$/;

/**
 * `nativeType` named as introspection reports it, on the contract side and the introspected side alike: an alias under PostgreSQL's canonical name (`char(3)` is `character(3)`, `int` is `int4`), `timestamp(3) with time zone` as `timestamptz(3)`, `time without time zone` as `time`, and a list type's element the same way. A `float` with a precision is `real` or `double precision` depending on it, so it is left as written, and so is a name this does not describe, such as a user-defined type.
 */
export function normalizeSchemaNativeType(nativeType: string): string {
  const trimmed = nativeType.trim();
  if (trimmed.endsWith('[]')) return `${normalizeSchemaNativeType(trimmed.slice(0, -2))}[]`;
  const parts = NATIVE_TYPE_PARTS.exec(trimmed);
  if (parts === null) return trimmed;
  const [, base = '', modifier = '', zone = ''] = parts;
  if (zone !== '') {
    const zoned = WITH_TIME_ZONE.get(base);
    if (zoned === undefined) return trimmed;
    return `${zone === ' with time zone' ? zoned : base}${modifier}`;
  }
  if (base === 'float' && modifier !== '') return trimmed;
  return `${TYPE_NAME_ALIASES.get(base) ?? base}${modifier}`;
}

/** The types PostgreSQL stores with a length of 1 when none is written, and reports that way. */
const LENGTH_ONE_WHEN_BARE: ReadonlySet<string> = new Set(['character', 'bit']);

/** A normalized type name with the length PostgreSQL gives `character` and `bit` when none is written. */
export function withLengthOneWhenBare(typeName: string): string {
  return LENGTH_ONE_WHEN_BARE.has(typeName) ? `${typeName}(1)` : typeName;
}

/**
 * The type columns introspection reads for one column: `format_type(atttypid, atttypmod)` and the
 * `information_schema.columns` type fields.
 */
export interface CatalogColumnType {
  readonly formattedType: string | null;
  readonly dataType: string;
  readonly udtName: string;
  readonly characterMaximumLength: number | null;
  readonly numericPrecision: number | null;
  readonly numericScale: number | null;
}

export interface IntrospectedNativeType {
  /** The column's native type; for an array column, its element type. */
  readonly nativeType: string;
  readonly many: true | undefined;
  /** The normalized full native type, with `[]` for an array column, as the contract side spells it. */
  readonly resolvedNativeType: string;
}

/** The native type introspection reports for a column, from its catalog type columns. */
export function introspectedNativeType(column: CatalogColumnType): IntrospectedNativeType {
  const reported = reportedNativeType(column);
  const many = reported.endsWith('[]') ? true : undefined;
  const nativeType = many ? normalizeSchemaNativeType(reported.slice(0, -2)) : reported;
  return {
    nativeType,
    many,
    resolvedNativeType: `${normalizeSchemaNativeType(nativeType)}${many ? '[]' : ''}`,
  };
}

function reportedNativeType(column: CatalogColumnType): string {
  if (column.formattedType) {
    return normalizeFormattedType(column.formattedType);
  }
  if (column.dataType === 'character varying' || column.dataType === 'character') {
    return column.characterMaximumLength
      ? `${column.dataType}(${column.characterMaximumLength})`
      : column.dataType;
  }
  if (column.dataType === 'numeric' || column.dataType === 'decimal') {
    if (column.numericPrecision && column.numericScale !== null) {
      return `${column.dataType}(${column.numericPrecision},${column.numericScale})`;
    }
    return column.numericPrecision
      ? `${column.dataType}(${column.numericPrecision})`
      : column.dataType;
  }
  return column.udtName || column.dataType;
}

/**
 * `format_type`'s name for a column type, named as the contract names it: a built-in type through {@link normalizeSchemaNativeType}, and a user-defined type, which `format_type` quotes where it needs to (mixed case, a reserved word, a dot) and schema-qualifies outside the search path, with each identifier unquoted.
 */
function normalizeFormattedType(formattedType: string): string {
  if (formattedType.endsWith('[]')) {
    return `${normalizeFormattedType(formattedType.slice(0, -2))}[]`;
  }
  const normalized = normalizeSchemaNativeType(formattedType);
  if (normalized !== formattedType) return normalized;
  return splitQualifiedName(formattedType).map(unquoteIdentifier).join('.');
}

function splitQualifiedName(name: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of name) {
    if (char === '"') quoted = !quoted;
    if (char === '.' && !quoted) {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

function unquoteIdentifier(segment: string): string {
  return segment.length >= 2 && segment.startsWith('"') && segment.endsWith('"')
    ? segment.slice(1, -1).replaceAll('""', '"')
    : segment;
}
