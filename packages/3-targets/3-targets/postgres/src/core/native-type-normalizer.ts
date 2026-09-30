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
