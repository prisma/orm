import { blindCast } from '@internal/utils/casts';
import { type CustomTypesConfig, types as pgTypes } from 'pg';

const DATE_OID = 1082;
const TIME_OID = 1083;
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;

export const PG_TYPES_ARRAY_OIDS: ReadonlySet<number> = new Set([
  651, 791, 199, 1000, 1001, 1005, 1007, 1008, 1009, 1014, 1015, 1016, 1017, 1021, 1022, 1028, 1040,
  1041, 1115, 1182, 1183, 1185, 1187, 1231, 1270, 2951, 3807, 3907,
]);

const TEMPORAL_SCALAR_OIDS: ReadonlySet<number> = new Set([
  DATE_OID,
  TIME_OID,
  TIMESTAMP_OID,
  TIMESTAMPTZ_OID,
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

function createTextTypes(rawTextOids: ReadonlySet<number>): CustomTypesConfig {
  return {
    getTypeParser(oid, format) {
      if (rawTextOids.has(oid)) {
        return serverText;
      }
      return getTypeParser(oid, format);
    },
  };
}

export const controlTextTypes = createTextTypes(PG_TYPES_ARRAY_OIDS);
export const temporalTextTypes = createTextTypes(
  new Set([...TEMPORAL_SCALAR_OIDS, ...PG_TYPES_ARRAY_OIDS]),
);
