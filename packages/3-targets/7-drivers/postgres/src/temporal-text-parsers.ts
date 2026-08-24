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

type GetTypeParser = (oid: number, format?: 'text' | 'binary' | undefined) => TextParser;

function getTypeParser(oid: number, format?: 'text' | 'binary'): TextParser {
  return blindCast<
    GetTypeParser,
    "pg-types' TypeId enum lists only scalar OIDs; getTypeParser resolves any OID from its map"
  >(pgTypes.getTypeParser)(oid, format);
}

function serverText(value: string): string {
  return value;
}

type ArrayParser = {
  readonly create: (source: string) => { readonly parse: () => unknown[] };
};

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
