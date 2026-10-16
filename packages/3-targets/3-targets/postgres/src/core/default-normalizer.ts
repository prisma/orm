/**
 * Reading the default a PostgreSQL column reports (`pg_get_expr` of the column's default): a recognized function, SQL NULL, or a literal whose body this module takes out of the quotes, `::type` casts and `E''` escapes. The column's codec reads the body (ADR 254); nothing here knows a data type.
 */

import type { ColumnDefault } from '@internal/contract/types';
import type { ReportedLiteralDefault } from '@internal/family-sql/control';

export const NEXTVAL_PATTERN = /^nextval\s*\(/i;
const NOW_FUNCTION_PATTERN = /^(now\s*\(\s*\)|CURRENT_TIMESTAMP)$/i;
const CLOCK_TIMESTAMP_PATTERN = /^clock_timestamp\s*\(\s*\)$/i;
const TIMESTAMP_CAST_SUFFIX = /::timestamp(?:tz|\s+(?:with|without)\s+time\s+zone)?$/i;
const TEXT_CAST_SUFFIX = /::text$/i;
const NOW_LITERAL_PATTERN = /^'now'$/i;
export const UUID_PATTERN = /^gen_random_uuid\s*\(\s*\)$/i;
export const UUID_OSSP_PATTERN = /^uuid_generate_v4\s*\(\s*\)$/i;
export const NULL_PATTERN = /^NULL(?:::.+)?$/i;
export const TRUE_PATTERN = /^true$/i;
export const FALSE_PATTERN = /^false$/i;
/**
 * A decimal numeral with an optional sign and an optional exponent. Postgres prints a `real` or
 * `double precision` default in exponent notation once its magnitude is large or small enough:
 * `'1e+20'::real`, `'1e-320'::double precision`.
 */
const NUMERAL = String.raw`[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`;
export const NUMERIC_PATTERN = new RegExp(`^${NUMERAL}$`);

/**
 * A type modifier: `(3)`, `(65,30)`, or a numeric type's negative scale, `(5,-2)`, which PostgreSQL
 * 15 and later accept.
 */
export const TYPE_MODIFIER = String.raw`\(\d+(?:,\s*-?\d+)?\)`;

/**
 * A cast target type: a builtin of one or more words, where any word may carry a modifier
 * (`timestamp(3) without time zone`, `numeric(65,30)`), or a quoted identifier (`"AuditAction"`);
 * either may be qualified by a possibly quoted schema (`audit."AuditAction"`, `"my schema".t`).
 */
const TYPE_NAME = String.raw`(?:(?:"(?:[^"]|"")+"|\w+)\.)?(?:"(?:[^"]|"")+"|\w+(?:${TYPE_MODIFIER})?(?:\s+\w+(?:${TYPE_MODIFIER})?)*)`;
const QUOTED_LITERAL_PATTERN = new RegExp(`^'((?:[^']|'')*)'(?:::(${TYPE_NAME}))?$`);
/** A string constant with backslash escapes, `E'...'`, which PostgreSQL prints when `standard_conforming_strings` is off. */
const ESCAPE_STRING_LITERAL_PATTERN = new RegExp(
  String.raw`^[Ee]'((?:[^'\\]|\\.|'')*)'(?:::(${TYPE_NAME}))?$`,
  's',
);
const NUMBER_LITERAL_PATTERN = new RegExp(`^(${NUMERAL})(?:::(${TYPE_NAME}))?$`);
const PARENTHESISED_CAST_PATTERN = new RegExp(String.raw`^\((.+)\)::(${TYPE_NAME})$`, 's');
const INTEGER_PATTERN = /^-?\d+$/;
const INTEGER_TYPE_PATTERN = /^(?:smallint|integer|bigint|int2|int4|int8)$/i;
export const NUMBER_TYPE_PATTERN = new RegExp(
  `^(?:smallint|integer|bigint|int2|int4|int8|real|double precision|float4|float8|numeric|decimal)(?:${TYPE_MODIFIER})?$`,
  'i',
);
/**
 * Matches a Postgres array literal default of the form `'{...}'::elemtype[]`.
 * The literal body is captured in group 1; the cast (including `[]`) is optional.
 * Examples: `'{}'::text[]`, `'{1,2}'::integer[]`, `'{}'`
 */
export const ARRAY_LITERAL_PATTERN = /^'(\{.*\})'(?:::.+\[\])?$/;

/** `box` is the one core type whose array elements are delimited by `;`, not `,`. */
export const SEMICOLON_DELIMITED_ELEMENT_TYPE_PATTERN = /^box$/i;

/**
 * Matches the constructor spelling Postgres reports for a default written as
 * `ARRAY[...]`: `ARRAY['a'::text, 'b'::text]`, `ARRAY[1, 2]`, `ARRAY[]::text[]`.
 * The element list is captured in group 1; the outer cast is optional.
 */
export const ARRAY_CONSTRUCTOR_PATTERN = new RegExp(
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
export function canonicalizeTimestampDefault(expr: string): string | undefined {
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

export type LiteralToken =
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
export function readLiteralToken(expression: string): LiteralToken | undefined {
  const escaped = ESCAPE_STRING_LITERAL_PATTERN.exec(expression);
  const quoted = escaped ?? QUOTED_LITERAL_PATTERN.exec(expression);
  if (quoted?.[1] !== undefined) {
    const text = escaped === null ? quoted[1].replace(/''/g, "'") : unescapeEscapeString(quoted[1]);
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

export type ArrayElementToken = { readonly value: string; readonly quoted: boolean };

/**
 * Splits a Postgres array literal body (without the enclosing braces) into its
 * element tokens, honouring quoting. A comma only separates elements when it is
 * outside double quotes; inside a quoted element a doubled quote (`""`) or a
 * backslash-escaped quote (`\"`) is a literal quote, and a backslash escapes the
 * next character. Returns undefined if the body is malformed (e.g. an unbalanced
 * quote), nests an array, which puts a brace outside quotes, or escapes a character outside
 * quotes with a backslash, which Postgres never prints.
 */
export function splitArrayElements(inner: string): readonly ArrayElementToken[] | undefined {
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
    if (char === '{' || char === '}' || char === '\\') return undefined;
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
 * Splits an `ARRAY[...]` element list on the commas outside quotes and parentheses, so
 * `numeric(65,30)` and `'a,b'` stay inside one element. A doubled quote inside an element is a
 * literal quote, so it never closes one.
 */
export function splitConstructorElements(body: string): readonly string[] {
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

export function unwrapOuterArrayCasts(expression: string): string {
  const match = OUTER_ARRAY_CAST_PATTERN.exec(expression);
  return match?.[1] === undefined ? expression : unwrapOuterArrayCasts(match[1].trim());
}

const BACKSLASH_ESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** The text of an `E'...'` string constant: a doubled quote is a quote, and a backslash escapes the next character, an octal byte or a hexadecimal byte. */
function unescapeEscapeString(body: string): string {
  return body.replace(
    /''|\\([0-7]{1,3}|x[0-9A-Fa-f]{1,2}|.)/gs,
    (_match: string, escaped: string | undefined) => {
      if (escaped === undefined) return "'";
      if (/^[0-7]/.test(escaped)) return String.fromCharCode(Number.parseInt(escaped, 8));
      if (escaped.startsWith('x') && escaped.length > 1) {
        return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
      }
      return BACKSLASH_ESCAPES[escaped] ?? escaped;
    },
  );
}

/** What a column's reported default is: a function, SQL NULL, or a literal the column's codec reads. */
export type PostgresReportedDefault =
  | { readonly kind: 'function'; readonly expression: string }
  | { readonly kind: 'null' }
  | { readonly kind: 'literal'; readonly literal: ReportedLiteralDefault };

function functionDefault(expression: string): PostgresReportedDefault {
  return { kind: 'function', expression };
}

/**
 * Reads a column's reported default. `nativeType` ends in `[]` for a list column, whose literal is an array literal (`'{a,b}'::text[]`) or an `ARRAY[...]` constructor of literals. A `nextval(...)` default is `autoincrement()`, and the forms of `now()` and of `gen_random_uuid()` are named as the contract names them. Any other expression is a function default, kept as reported.
 */
export function readPostgresDefault(
  rawDefault: string,
  nativeType?: string,
): PostgresReportedDefault {
  const trimmed = rawDefault.trim();
  if (NEXTVAL_PATTERN.test(trimmed)) return functionDefault('autoincrement()');
  if (NULL_PATTERN.test(trimmed)) return { kind: 'null' };
  if (nativeType?.endsWith('[]')) {
    const elements = listElementBodies(trimmed, nativeType.slice(0, -2));
    return elements === undefined
      ? functionDefault(trimmed)
      : { kind: 'literal', literal: { kind: 'list', elements } };
  }
  const timestampFunction = canonicalizeTimestampDefault(trimmed);
  if (timestampFunction !== undefined) return functionDefault(timestampFunction);
  if (UUID_PATTERN.test(trimmed) || UUID_OSSP_PATTERN.test(trimmed)) {
    return functionDefault('gen_random_uuid()');
  }
  const body = literalBody(trimmed);
  return body === undefined
    ? functionDefault(trimmed)
    : { kind: 'literal', literal: { kind: 'value', body } };
}

/** The body of a scalar literal: `true`, `false`, a numeral, or the text of a quoted string. */
function literalBody(expression: string): string | undefined {
  if (TRUE_PATTERN.test(expression)) return 'true';
  if (FALSE_PATTERN.test(expression)) return 'false';
  const token = readLiteralToken(expression);
  if (token === undefined) return undefined;
  return token.kind === 'number' ? token.numeral : token.text;
}

/** The element bodies of a list literal, with `null` for SQL NULL, or `undefined` when the default is not a list of literals. */
function listElementBodies(
  expression: string,
  elementType: string,
): readonly (string | null)[] | undefined {
  const arrayLiteral = ARRAY_LITERAL_PATTERN.exec(expression)?.[1];
  if (arrayLiteral !== undefined && !SEMICOLON_DELIMITED_ELEMENT_TYPE_PATTERN.test(elementType)) {
    return arrayLiteralElements(arrayLiteral.replace(/''/g, "'"));
  }
  const constructed = ARRAY_CONSTRUCTOR_PATTERN.exec(unwrapOuterArrayCasts(expression))?.[1];
  if (constructed === undefined) return undefined;
  if (constructed.trim() === '') return [];
  const elements: (string | null)[] = [];
  for (const element of splitConstructorElements(constructed)) {
    if (NULL_PATTERN.test(element)) {
      elements.push(null);
      continue;
    }
    const body = literalBody(element);
    if (body === undefined) return undefined;
    elements.push(body);
  }
  return elements;
}

/** The elements of an array literal (`{...}`): a quoted element is its text, and an unquoted `NULL` is SQL NULL. */
function arrayLiteralElements(literal: string): readonly (string | null)[] | undefined {
  const inner = literal.slice(1, -1).trim();
  if (inner === '') return [];
  const tokens = splitArrayElements(inner);
  if (tokens === undefined) return undefined;
  const elements: (string | null)[] = [];
  for (const token of tokens) {
    if (token.quoted) {
      elements.push(token.value);
      continue;
    }
    const element = token.value.trim();
    if (element === '') return undefined;
    elements.push(element.toUpperCase() === 'NULL' ? null : element);
  }
  return elements;
}

/**
 * Names a contract's expression default the way {@link readPostgresDefault} names the same function in the database, so `` sql`CURRENT_TIMESTAMP` `` and the database's `CURRENT_TIMESTAMP` compare equal, and a `nextval(...)` default is `autoincrement()`. A literal default, and an expression that writes a literal, pass through unchanged; introspection reads the latter's literal with the column's codec, and the diff compares the values.
 */
export function postgresResolveDefault(
  def: ColumnDefault,
  resolvedNativeType: string,
): ColumnDefault {
  if (def.kind !== 'function') return def;
  const read = readPostgresDefault(def.expression, resolvedNativeType);
  return read.kind === 'function' ? read : def;
}
