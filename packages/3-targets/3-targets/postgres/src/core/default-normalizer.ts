import type { ColumnDefault, JsonValue } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';

/**
 * Pre-compiled regex patterns for performance.
 * These are compiled once at module load time rather than on each function call.
 */
const NEXTVAL_PATTERN = /^nextval\s*\(/i;
const NOW_FUNCTION_PATTERN = /^(now\s*\(\s*\)|CURRENT_TIMESTAMP)$/i;
const CLOCK_TIMESTAMP_PATTERN = /^clock_timestamp\s*\(\s*\)$/i;
const TIMESTAMP_CAST_SUFFIX = /::timestamp(?:tz|\s+(?:with|without)\s+time\s+zone)?$/i;
const TEXT_CAST_SUFFIX = /::text$/i;
const NOW_LITERAL_PATTERN = /^'now'$/i;
const UUID_PATTERN = /^gen_random_uuid\s*\(\s*\)$/i;
const UUID_OSSP_PATTERN = /^uuid_generate_v4\s*\(\s*\)$/i;
const NULL_PATTERN = /^NULL(?:::.+)?$/i;
const TRUE_PATTERN = /^true$/i;
const FALSE_PATTERN = /^false$/i;
/**
 * A decimal numeral with an optional sign and an optional exponent. Postgres prints a `real` or
 * `double precision` default in exponent notation once its magnitude is large or small enough:
 * `'1e+20'::real`, `'1e-320'::double precision`.
 */
const NUMERAL = String.raw`[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`;
const NUMERIC_PATTERN = new RegExp(`^${NUMERAL}$`);

/**
 * A cast target type: a builtin of one or more words, where any word may carry a modifier
 * (`timestamp(3) without time zone`, `numeric(65,30)`), or a quoted identifier (`"AuditAction"`);
 * either may be qualified by a possibly quoted schema (`audit."AuditAction"`, `"my schema".t`).
 */
const TYPE_NAME = String.raw`(?:(?:"(?:[^"]|"")+"|\w+)\.)?(?:"(?:[^"]|"")+"|\w+(?:\(\d+(?:,\s*\d+)?\))?(?:\s+\w+(?:\(\d+(?:,\s*\d+)?\))?)*)`;
const QUOTED_LITERAL_PATTERN = new RegExp(`^'((?:[^']|'')*)'(?:::(${TYPE_NAME}))?$`);
const NUMBER_LITERAL_PATTERN = new RegExp(`^(${NUMERAL})(?:::(${TYPE_NAME}))?$`);
const PARENTHESISED_CAST_PATTERN = new RegExp(String.raw`^\((.+)\)::(${TYPE_NAME})$`, 's');
const INTEGER_PATTERN = /^-?\d+$/;
const INTEGER_TYPE_PATTERN = /^(?:smallint|integer|bigint|int2|int4|int8)$/i;
const NUMBER_TYPE_PATTERN =
  /^(?:smallint|integer|bigint|int2|int4|int8|real|double precision|float4|float8|numeric|decimal)(?:\(\d+(?:,\s*\d+)?\))?$/i;
const DECIMAL_TEXT_TYPE_PATTERN = /^(?:bigint|int8|numeric|decimal)(?:\(\d+(?:,\s*\d+)?\))?$/i;

/**
 * Matches a Postgres array literal default of the form `'{...}'::elemtype[]`.
 * The literal body is captured in group 1; the cast (including `[]`) is optional.
 * Examples: `'{}'::text[]`, `'{1,2}'::integer[]`, `'{}'`
 */
const ARRAY_LITERAL_PATTERN = /^'(\{.*\})'(?:::.+\[\])?$/;

/**
 * Matches the constructor spelling Postgres reports for a default written as
 * `ARRAY[...]`: `ARRAY['a'::text, 'b'::text]`, `ARRAY[1, 2]`, `ARRAY[]::text[]`.
 * The element list is captured in group 1; the outer cast is optional.
 */
const ARRAY_CONSTRUCTOR_PATTERN = new RegExp(
  String.raw`^ARRAY\[(.*?)\](?:::${TYPE_NAME}\[\])?$`,
  'is',
);
const OUTER_ARRAY_CAST_PATTERN = new RegExp(String.raw`^\((.+)\)::${TYPE_NAME}\[\]$`, 's');

/**
 * Returns the canonical expression for a timestamp default function, or undefined
 * if the expression is not a recognized timestamp default.
 *
 * Keeps now()/CURRENT_TIMESTAMP and clock_timestamp() distinct:
 * - now(), CURRENT_TIMESTAMP, ('now'::text)::timestamp... → 'now()'
 * - clock_timestamp(), clock_timestamp()::timestamptz → 'clock_timestamp()'
 *
 * These are semantically different in Postgres: now() returns the transaction
 * start time (constant within a transaction), while clock_timestamp() returns
 * the actual wall-clock time (can differ across rows in a single INSERT).
 */
function canonicalizeTimestampDefault(expr: string): string | undefined {
  if (NOW_FUNCTION_PATTERN.test(expr)) return 'now()';
  if (CLOCK_TIMESTAMP_PATTERN.test(expr)) return 'clock_timestamp()';

  if (!TIMESTAMP_CAST_SUFFIX.test(expr)) return undefined;

  let inner = expr.replace(TIMESTAMP_CAST_SUFFIX, '').trim();

  if (inner.startsWith('(') && inner.endsWith(')')) {
    inner = inner.slice(1, -1).trim();
  }

  if (NOW_FUNCTION_PATTERN.test(inner)) return 'now()';
  if (CLOCK_TIMESTAMP_PATTERN.test(inner)) return 'clock_timestamp()';

  inner = inner.replace(TEXT_CAST_SUFFIX, '').trim();
  if (NOW_LITERAL_PATTERN.test(inner)) return 'now()';

  return undefined;
}

type LiteralToken =
  | { readonly kind: 'number'; readonly numeral: string }
  | { readonly kind: 'string'; readonly text: string };

/**
 * A numeral cast to a number type. A cast to an integer type rounds a fraction, so that numeral is
 * not the value.
 */
function castNumber(numeral: string, castType: string | undefined): LiteralToken | undefined {
  if (castType === undefined) return { kind: 'number', numeral };
  if (!NUMBER_TYPE_PATTERN.test(castType)) return undefined;
  if (INTEGER_TYPE_PATTERN.test(castType) && !INTEGER_PATTERN.test(numeral)) return undefined;
  return { kind: 'number', numeral };
}

/**
 * Reads a literal by its cast type: `'-1'::integer` and `(1)::bigint` are numbers, `'a'::text` is a
 * string. A parenthesised cast is read only from number to number: `('now'::text)::date` is
 * evaluated on insert. Anything else, such as an operator or a function call, is not a literal.
 */
function readLiteralToken(expression: string): LiteralToken | undefined {
  const quoted = QUOTED_LITERAL_PATTERN.exec(expression);
  if (quoted?.[1] !== undefined) {
    const text = quoted[1].replace(/''/g, "'");
    const castType = quoted[2];
    return castType !== undefined &&
      NUMBER_TYPE_PATTERN.test(castType) &&
      NUMERIC_PATTERN.test(text)
      ? castNumber(text, castType)
      : { kind: 'string', text };
  }
  const number = NUMBER_LITERAL_PATTERN.exec(expression);
  if (number?.[1] !== undefined) return castNumber(number[1], number[2]);
  const parenthesised = PARENTHESISED_CAST_PATTERN.exec(expression);
  if (parenthesised?.[1] === undefined || parenthesised[2] === undefined) return undefined;
  const inner = readLiteralToken(parenthesised[1].trim());
  return inner?.kind === 'number' ? castNumber(inner.numeral, parenthesised[2]) : undefined;
}

/**
 * `int8` and `numeric` defaults are decimal text, the JSON form of their codecs, so no digit is
 * lost to a JavaScript number. A column that is not a number type stores the numeral as text.
 */
function numberValue(numeral: string, nativeType: string | undefined): JsonValue | undefined {
  if (nativeType !== undefined && DECIMAL_TEXT_TYPE_PATTERN.test(nativeType)) return numeral;
  if (nativeType !== undefined && !NUMBER_TYPE_PATTERN.test(nativeType)) return numeral;
  const parsed = Number(numeral);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type ArrayElementToken = { readonly value: string; readonly quoted: boolean };

/**
 * Splits a Postgres array literal body (without the enclosing braces) into its
 * element tokens, honouring quoting. A comma only separates elements when it is
 * outside double quotes; inside a quoted element a doubled quote (`""`) or a
 * backslash-escaped quote (`\"`) is a literal quote, and a backslash escapes the
 * next character. Returns undefined if the body is malformed (e.g. an unbalanced
 * quote).
 */
function splitArrayElements(inner: string): readonly ArrayElementToken[] | undefined {
  const tokens: ArrayElementToken[] = [];
  let current = '';
  let inQuotes = false;
  let quoted = false;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (inQuotes) {
      if (char === '\\') {
        const next = inner[i + 1];
        if (next === undefined) return undefined;
        current += next;
        i++;
        continue;
      }
      if (char === '"') {
        if (inner[i + 1] === '"') {
          current += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (char === ',') {
      tokens.push({ value: current, quoted });
      current = '';
      quoted = false;
      continue;
    }
    current += char;
  }

  if (inQuotes) return undefined;
  tokens.push({ value: current, quoted });
  return tokens;
}

/**
 * Parses a Postgres array literal body (`{...}`) into a JS array of primitives.
 * Returns undefined if the body cannot be reliably parsed.
 *
 * Handles:
 * - `{}` → `[]`
 * - `{elem1,elem2,...}` → `[elem1, elem2, ...]` with numeric and string element coercion
 * - quoted elements that contain commas, doubled/escaped quotes, and the literal
 *   strings `NULL`/`true`/`false` (a quoted token is always a string)
 */
function parseArrayLiteralBody(
  body: string,
  elementType: string,
): readonly JsonValue[] | undefined {
  const inner = body.slice(1, -1).trim();
  if (inner === '') return [];
  const tokens = splitArrayElements(inner);
  if (tokens === undefined) return undefined;
  const result: JsonValue[] = [];
  for (const token of tokens) {
    if (token.quoted) {
      // A quoted token is always a string — `"NULL"`, `"true"`, `"1"` are the
      // literal text, never the keyword/number.
      result.push(textElementValue(token.value, elementType));
      continue;
    }
    const el = token.value.trim();
    if (el.toUpperCase() === 'NULL') {
      // A `json`/`jsonb` element's quoted `'null'` is the JSON value null, and an unquoted SQL NULL
      // is the absence of a value. Both would read back as JSON null, so the whole default is left
      // as its raw expression rather than printed as one the other reads back as.
      if (isJsonElementType(elementType)) return undefined;
      result.push(null);
      continue;
    }
    if (el === 'true') {
      result.push(true);
      continue;
    }
    if (el === 'false') {
      result.push(false);
      continue;
    }
    if (NUMERIC_PATTERN.test(el)) {
      const value = numberValue(el, elementType);
      if (value === undefined) return undefined;
      result.push(value);
      continue;
    }
    return undefined;
  }
  return result;
}

/**
 * Splits an `ARRAY[...]` element list on the commas outside quotes and parentheses, so
 * `numeric(65,30)` and `'a,b'` stay inside one element. A doubled quote inside an element is a
 * literal quote, so it never closes one.
 */
function splitConstructorElements(body: string): readonly string[] {
  const elements: string[] = [];
  let current = '';
  let quote: string | undefined;
  let depth = 0;
  for (const char of body) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    } else if (char === ',' && depth === 0) {
      elements.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  elements.push(current);
  return elements.map((element) => element.trim());
}

/**
 * Reads one `ARRAY[...]` element: NULL, a boolean, or a literal read by its cast type. Anything
 * else, such as a function call, means the constructor is not a literal and the caller keeps the
 * raw expression.
 */
function parseConstructorElement(element: string, elementType: string): JsonValue | undefined {
  // See `parseArrayLiteralBody`: an unquoted SQL NULL in a json list is not the JSON value null.
  if (NULL_PATTERN.test(element)) return isJsonElementType(elementType) ? undefined : null;
  if (TRUE_PATTERN.test(element)) return true;
  if (FALSE_PATTERN.test(element)) return false;
  const token = readLiteralToken(element);
  if (token === undefined) return undefined;
  return token.kind === 'number'
    ? numberValue(token.numeral, elementType)
    : textElementValue(token.text, elementType);
}

function isJsonElementType(elementType: string): boolean {
  return elementType === 'json' || elementType === 'jsonb';
}

/** A `json`/`jsonb` element's text is a JSON document, as it is on a scalar column of the same type. */
function textElementValue(text: string, elementType: string): JsonValue {
  if (!isJsonElementType(elementType)) return text;
  try {
    return blindCast<JsonValue, 'JSON.parse yields a JSON value'>(JSON.parse(text));
  } catch {
    return text;
  }
}

function parseArrayConstructor(
  body: string,
  elementType: string,
): readonly JsonValue[] | undefined {
  if (body.trim() === '') return [];
  const values: JsonValue[] = [];
  for (const element of splitConstructorElements(body)) {
    const value = parseConstructorElement(element, elementType);
    if (value === undefined) return undefined;
    values.push(value);
  }
  return values;
}

function unwrapOuterArrayCasts(expression: string): string {
  const match = OUTER_ARRAY_CAST_PATTERN.exec(expression);
  return match?.[1] === undefined ? expression : unwrapOuterArrayCasts(match[1].trim());
}

/**
 * Parses a raw Postgres column default expression into a normalized ColumnDefault.
 * This enables semantic comparison between contract defaults and introspected schema defaults.
 *
 * Used by the migration diff layer to normalize raw database defaults during comparison,
 * keeping the introspection layer focused on faithful data capture.
 *
 * @param rawDefault - Raw default expression from information_schema.columns.column_default
 * @param nativeType - Native column type, used for type-aware parsing (array, int8, numeric, JSON)
 * @returns Normalized ColumnDefault or undefined if the expression cannot be parsed
 */
export function parsePostgresDefault(
  rawDefault: string,
  nativeType?: string,
): ColumnDefault | undefined {
  const trimmed = rawDefault.trim();
  const normalizedType = nativeType?.toLowerCase();

  if (NEXTVAL_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'autoincrement()' };
  }

  if (normalizedType?.endsWith('[]')) {
    const elementType = normalizedType.slice(0, -2);
    const arrayMatch = trimmed.match(ARRAY_LITERAL_PATTERN);
    if (arrayMatch?.[1] !== undefined) {
      const parsed = parseArrayLiteralBody(arrayMatch[1], elementType);
      if (parsed !== undefined) {
        return { kind: 'literal', value: parsed };
      }
    }
    const constructorMatch = unwrapOuterArrayCasts(trimmed).match(ARRAY_CONSTRUCTOR_PATTERN);
    if (constructorMatch?.[1] !== undefined) {
      const parsed = parseArrayConstructor(constructorMatch[1], elementType);
      if (parsed !== undefined) {
        return { kind: 'literal', value: parsed };
      }
    }
  }

  const canonicalTimestamp = canonicalizeTimestampDefault(trimmed);
  if (canonicalTimestamp) {
    return { kind: 'function', expression: canonicalTimestamp };
  }

  if (UUID_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'gen_random_uuid()' };
  }

  if (UUID_OSSP_PATTERN.test(trimmed)) {
    return { kind: 'function', expression: 'gen_random_uuid()' };
  }

  if (NULL_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: null };
  }

  if (TRUE_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: true };
  }
  if (FALSE_PATTERN.test(trimmed)) {
    return { kind: 'literal', value: false };
  }

  const token = readLiteralToken(trimmed);
  if (token === undefined) {
    return { kind: 'function', expression: trimmed };
  }

  if (token.kind === 'number') {
    const value = numberValue(token.numeral, normalizedType);
    return value === undefined ? undefined : { kind: 'literal', value };
  }

  if (normalizedType === 'json' || normalizedType === 'jsonb') {
    try {
      return { kind: 'literal', value: JSON.parse(token.text) };
    } catch {
      // Keep legacy behavior for malformed/non-JSON string content.
    }
  }
  return { kind: 'literal', value: token.text };
}

/**
 * Normalizes a contract-declared default through {@link parsePostgresDefault}
 * — the same parser introspection uses — so a function-shaped default the
 * parser recognizes as a literal (e.g. sql`'{}'::jsonb`)
 * resolves to the same `resolvedDefault` shape a live introspected column
 * would produce. Compensates once, at `SchemaIR` construction of the
 * expected (contract-derived) side (`contractToSchemaIR`'s `resolveDefault`
 * hook), instead of at every site that later compares the two sides. A
 * literal default, or a function form the parser doesn't recognize, passes
 * through unchanged; `nextval(...)` normalizes to `autoincrement()` on both
 * sides, matching a `serial`/identity column's introspected counterpart.
 */
export function postgresResolveDefault(
  def: ColumnDefault,
  resolvedNativeType: string,
): ColumnDefault {
  if (def.kind !== 'function') {
    return def;
  }
  return parsePostgresDefault(def.expression, resolvedNativeType) ?? def;
}
