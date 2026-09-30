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

/** PostgreSQL's other names for a type a contract can write, each with the name introspection reports it under. */
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

const NATIVE_TYPE_PARTS = /^([a-z][a-z ]*?)(\([^)]*\))?$/;

/**
 * `nativeType` with its type written under the name introspection reports: `char(3)` is `character(3)`, and `int` is `int4`. A `float` with a precision is `real` or `double precision` depending on it, so it is left as written, and so is a type the name and modifier do not describe, such as `timestamp(3) with time zone`.
 */
export function canonicalPostgresTypeName(nativeType: string): string {
  const parts = NATIVE_TYPE_PARTS.exec(nativeType);
  if (parts === null) return nativeType;
  const [, base = '', modifier = ''] = parts;
  if (base === 'float' && modifier !== '') return nativeType;
  return `${TYPE_NAME_ALIASES.get(base) ?? base}${modifier}`;
}
