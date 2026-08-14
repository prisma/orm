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

type PgTypeOid = Parameters<typeof pgTypes.getTypeParser>[0];
type TextParser = (value: string) => unknown;

function serverText(value: string): string {
  return value;
}

let textArrayParser: TextParser | undefined;

// `text[]` splits the array literal into JS array elements and leaves each element as the server
// wrote it — the array structure without any per-element interpretation.
function parseTextArray(): TextParser {
  const parser: TextParser =
    textArrayParser ??
    pgTypes.getTypeParser(
      blindCast<
        PgTypeOid,
        "pg-types' TypeId enum lists only scalar OIDs, but getTypeParser resolves any OID; 1009 is text[]"
      >(TEXT_ARRAY_OID),
      'text',
    );
  textArrayParser = parser;
  return parser;
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
    return pgTypes.getTypeParser(oid, format);
  },
};
