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

const TEXT_ARRAY_OID = 1009;

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

/**
 * `pg-types`' own view of `getTypeParser`, which its published types understate.
 *
 * The declared parameter is `TypeId`, an enum of **scalar** OIDs only, but the function is a plain
 * lookup in an OID-keyed map — its own source comment says the oid is whatever
 * `SELECT oid FROM pg_type WHERE typname = …` returns. So the narrowing is a defect in the type
 * rather than a constraint of the function, and correcting it here is more honest than asserting at
 * each call site that some array OID is secretly an enum member. It also types the passthrough
 * below, which forwards an arbitrary OID for every type this module does not claim.
 */
const getTypeParser = blindCast<
  (oid: number, format?: 'text' | 'binary' | undefined) => TextParser,
  "pg-types' TypeId enum lists only scalar OIDs; getTypeParser resolves any OID from its map"
>(pgTypes.getTypeParser);

function serverText(value: string): string {
  return value;
}

let textArrayParser: TextParser | undefined;

/**
 * Borrows `pg`'s own `text[]` parser for the temporal array OIDs.
 *
 * It splits the array literal into elements and leaves each one exactly as the server wrote it,
 * which is the whole requirement: the array structure interpreted, the elements not. Delegating
 * rather than reimplementing means array-literal quoting, escaping, nesting and NULL handling stay
 * `pg`'s problem, and a fix there arrives here for free.
 *
 * `pg` exposes the underlying `arrayParser` too, and `arrayParser.create(value).parse()` is the
 * same code path — `parseStringArray` is literally that call behind a null guard. Reaching for it
 * would drop the OID from this file, but only by copying that guard back in, so it trades a number
 * for a duplicated fragment of the parser this module is trying not to reimplement.
 */
function parseTextArray(): TextParser {
  textArrayParser ??= getTypeParser(TEXT_ARRAY_OID, 'text');
  return textArrayParser;
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
      return parseTextArray();
    }
    return getTypeParser(oid, format);
  },
};
