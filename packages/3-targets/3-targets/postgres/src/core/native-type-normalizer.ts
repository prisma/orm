/**
 * Postgres native-type normalization.
 *
 * Lives in `target-postgres` because both the migration planner/runner (control
 * plane) and the introspection adapter (control plane) need to normalize raw
 * native-type strings to the same canonical form for comparison.
 */

/**
 * Lookup map for simple prefix-based type normalization.
 *
 * Using a Map for O(1) lookup instead of multiple startsWith checks.
 */
const TYPE_PREFIX_MAP: ReadonlyMap<string, string> = new Map([
  ['varchar', 'character varying'],
  ['bpchar', 'character'],
  ['varbit', 'bit varying'],
]);

/**
 * Normalizes a Postgres schema native type to its canonical form for comparison.
 *
 * Uses a pre-computed lookup map for simple prefix replacements (O(1))
 * and handles complex temporal type normalization separately.
 */
export function normalizeSchemaNativeType(nativeType: string): string {
  const trimmed = nativeType.trim();

  for (const [prefix, replacement] of TYPE_PREFIX_MAP) {
    if (trimmed.startsWith(prefix)) {
      return replacement + trimmed.slice(prefix.length);
    }
  }

  if (trimmed.includes(' with time zone')) {
    if (trimmed.startsWith('timestamp')) {
      return `timestamptz${trimmed.slice(9).replace(' with time zone', '')}`;
    }
    if (trimmed.startsWith('time')) {
      return `timetz${trimmed.slice(4).replace(' with time zone', '')}`;
    }
  }

  if (trimmed.includes(' without time zone')) {
    return trimmed.replace(' without time zone', '');
  }

  return trimmed;
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
    return normalizeFormattedType(column.formattedType, column.dataType, column.udtName);
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

function normalizeFormattedType(formattedType: string, dataType: string, udtName: string): string {
  if (formattedType.endsWith('[]')) {
    return `${normalizeFormattedType(formattedType.slice(0, -2), dataType, udtName)}[]`;
  }
  if (formattedType === 'integer') {
    return 'int4';
  }
  if (formattedType === 'smallint') {
    return 'int2';
  }
  if (formattedType === 'bigint') {
    return 'int8';
  }
  if (formattedType === 'real') {
    return 'float4';
  }
  if (formattedType === 'double precision') {
    return 'float8';
  }
  if (formattedType === 'boolean') {
    return 'bool';
  }
  if (formattedType.startsWith('varchar')) {
    return formattedType.replace('varchar', 'character varying');
  }
  if (formattedType.startsWith('bpchar')) {
    return formattedType.replace('bpchar', 'character');
  }
  if (formattedType.startsWith('varbit')) {
    return formattedType.replace('varbit', 'bit varying');
  }
  if (dataType === 'timestamp with time zone' || udtName === 'timestamptz') {
    return formattedType.replace('timestamp', 'timestamptz').replace(' with time zone', '').trim();
  }
  if (dataType === 'timestamp without time zone' || udtName === 'timestamp') {
    return formattedType.replace(' without time zone', '').trim();
  }
  if (dataType === 'time with time zone' || udtName === 'timetz') {
    return formattedType.replace('time', 'timetz').replace(' with time zone', '').trim();
  }
  if (dataType === 'time without time zone' || udtName === 'time') {
    return formattedType.replace(' without time zone', '').trim();
  }
  // `format_type` quotes a user-defined type name that needs it (mixed case,
  // reserved word, a dot) and schema-qualifies one outside the search path,
  // so a mixed-case enum in another schema arrives as `audit."AuditAction"`.
  // The contract side spells every type name unquoted (`audit.AuditAction`),
  // so strip the quotes from each identifier segment, splitting only on dots
  // that sit outside the quotes.
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
