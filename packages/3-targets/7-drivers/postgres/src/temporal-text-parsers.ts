import { blindCast } from '@internal/utils/casts';
import { type CustomTypesConfig, types as pgTypes } from 'pg';

const DATE_OID = 1082;
const TIME_OID = 1083;
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;

const DATE_ARRAY_OID = 1182;
const TIME_ARRAY_OID = 1183;
const TIMESTAMP_ARRAY_OID = 1115;
const TIMESTAMPTZ_ARRAY_OID = 1185;

const TEMPORAL_SCALAR_OIDS: ReadonlySet<number> = new Set([
  DATE_OID,
  TIME_OID,
  TIMESTAMP_OID,
  TIMESTAMPTZ_OID,
]);

const TEMPORAL_ARRAY_OIDS: ReadonlySet<number> = new Set([
  DATE_ARRAY_OID,
  TIME_ARRAY_OID,
  TIMESTAMP_ARRAY_OID,
  TIMESTAMPTZ_ARRAY_OID,
]);

type TextParser = (value: string) => unknown;

/** `pg-types`' own view of `getTypeParser`, which its published types understate — see below. */
type GetTypeParser = (oid: number, format?: 'text' | 'binary' | undefined) => TextParser;

/**
 * Resolves `pg`'s parser for an OID.
 *
 * The declared parameter is `TypeId`, an enum of **scalar** OIDs only, but the function is a plain
 * lookup in an OID-keyed map — `pg-types`' own source comment says the oid is whatever
 * `SELECT oid FROM pg_type WHERE typname = …` returns. So the narrowing is a defect in the type
 * rather than a constraint of the function, and correcting it is more honest than asserting at each
 * call site that some array OID is secretly an enum member.
 *
 * The `pgTypes.getTypeParser` property is read **inside** this function, never at module scope.
 * Four suites in other packages mock `pg` with a double that carries no `types` export, and a
 * module-scope read makes importing this driver throw in all of them — at import, for a reason
 * unrelated to what the test is doing. The laziness is the contract, not an accident of style.
 */
function getTypeParser(oid: number, format?: 'text' | 'binary'): TextParser {
  return blindCast<
    GetTypeParser,
    "pg-types' TypeId enum lists only scalar OIDs; getTypeParser resolves any OID from its map"
  >(pgTypes.getTypeParser)(oid, format);
}

function serverText(value: string): string {
  return value;
}

/** `pg-types`' `arrayParser` as it exists at runtime; its published type says otherwise — see below. */
type ArrayParser = {
  readonly create: (source: string) => { readonly parse: () => unknown[] };
};

/**
 * Splits a PostgreSQL array literal into its elements, leaving each one exactly as the server wrote
 * it. That is the whole requirement here: the array structure interpreted, the elements not.
 *
 * `pg`'s own parser does the splitting, so array-literal quoting, escaping, nesting and NULL
 * handling stay its problem and a fix there arrives here for free. Called with no transform, which
 * is what leaves the elements as text.
 *
 * The published type declares `arrayParser` as `(source, transform) => any[]`, but at runtime it is
 * `{ create }` — `create(source, transform)` returns an object with a `parse()`. The cast corrects
 * that declaration rather than asserting anything about a value.
 *
 * The empty-input guard mirrors `pg-types`' own `parseStringArray`, which is the wrapper this
 * bypasses: `pg` hands `null` straight through for an SQL NULL, and `array.parse` would throw on it.
 */
function parseTextArray(value: string): unknown {
  if (!value) {
    return null;
  }
  return blindCast<
    ArrayParser,
    'pg-types declares arrayParser as a function; at runtime it is an object exposing create()'
  >(pgTypes.arrayParser)
    .create(value)
    .parse();
}

/**
 * Per-query result parsers that keep PostgreSQL's temporal output as the text the server sent.
 * `pg`'s defaults build a JavaScript `Date` for `date`, `timestamp` and `timestamptz`, which
 * truncates microseconds and folds calendar/offset information into a single UTC instant. The codec
 * layer decides how a temporal value is represented, so the driver must not decide for it.
 *
 * Attach this to individual queries — never register it through `pg.types.setTypeParser` — so a
 * `Pool` or `Client` the driver was handed keeps parsing its own traffic exactly as its owner
 * configured it.
 *
 * Nothing in this module reads `pg.types` until a result row is actually parsed, so importing the
 * driver never depends on `pg`'s parser registry being present.
 *
 * @see https://node-postgres.com/features/types
 */
export const temporalTextTypes: CustomTypesConfig = {
  getTypeParser(oid, format) {
    if (TEMPORAL_SCALAR_OIDS.has(oid)) {
      return serverText;
    }
    if (TEMPORAL_ARRAY_OIDS.has(oid)) {
      return parseTextArray;
    }
    return getTypeParser(oid, format);
  },
};
