import { blindCast } from '@internal/utils/casts';
import { type CustomTypesConfig, types as pgTypes } from 'pg';

export const PG_TYPES_ARRAY_OIDS: ReadonlySet<number> = new Set([
  651, 791, 199, 1000, 1001, 1005, 1007, 1008, 1009, 1014, 1015, 1016, 1017, 1021, 1022, 1028, 1040,
  1041, 1115, 1182, 1183, 1185, 1187, 1231, 1270, 2951, 3807, 3907,
]);

type TextParser = (value: string) => unknown;

type GetTypeParser = (oid: number, format?: 'text' | 'binary' | undefined) => TextParser;

function pgTypeParser(oid: number, format?: 'text' | 'binary'): TextParser {
  return blindCast<
    GetTypeParser,
    "pg-types' TypeId enum lists only scalar OIDs; getTypeParser resolves any OID from its map"
  >(pgTypes.getTypeParser)(oid, format);
}

function serverText(value: string): string {
  return value;
}

export const serverTextTypes: CustomTypesConfig = {
  getTypeParser: () => serverText,
};

export const controlTextTypes: CustomTypesConfig = {
  getTypeParser(oid, format) {
    return PG_TYPES_ARRAY_OIDS.has(oid) ? serverText : pgTypeParser(oid, format);
  },
};
