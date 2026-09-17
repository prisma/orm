import {
  ArgType,
  ColumnType,
  ColumnTypeEnum,
  IsolationLevel,
  normalizeTimestamp,
  normalizeTimestamptz,
} from '@prisma/driver-adapter-utils'
import { getTypeParser } from 'pg-types'
import { parse as parseArray } from 'postgres-array'

/**
 * Converts Prisma ORM isolation level to PostgreSQL SQL syntax.
 */
export function isolationLevelToSql(level: IsolationLevel): string {
  switch (level) {
    case 'READ UNCOMMITTED':
      return 'READ UNCOMMITTED'
    case 'READ COMMITTED':
      return 'READ COMMITTED'
    case 'REPEATABLE READ':
      return 'REPEATABLE READ'
    case 'SERIALIZABLE':
      return 'SERIALIZABLE'
    case 'SNAPSHOT':
      // PostgreSQL doesn't have SNAPSHOT, use REPEATABLE READ as closest match
      return 'REPEATABLE READ'
    default:
      throw new Error(`Unknown isolation level: ${level}`)
  }
}

/**
 * Converts Prisma ORM query parameters to PPG client-compatible values.
 *
 * @param args - The Prisma ORM argument values to convert.
 * @param argTypes - The Prisma ORM argument types.
 * @returns The equivalent PPG client parameter values.
 */
export function convertArgs(args: Array<unknown>, argTypes: Array<ArgType>): Array<unknown> {
  return args.map((arg, index) => {
    const argType = argTypes[index]

    // Handle null
    if (arg === null || arg === undefined) {
      return null
    }

    const scalarType = argType.scalarType
    switch (scalarType) {
      case 'int':
      case 'bigint':
      case 'float':
      case 'decimal':
      case 'string':
      case 'enum':
      case 'boolean':
        return String(arg)

      case 'datetime':
        // PostgreSQL expects ISO 8601 format
        if (arg instanceof Date) {
          return arg.toISOString()
        }
        return arg

      case 'json':
        return typeof arg === 'string' ? arg : JSON.stringify(arg)

      case 'bytes':
        // Convert Uint8Array/Buffer to hex string for PostgreSQL bytea
        if (arg instanceof Uint8Array) {
          return `\\x${Array.from(arg)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')}`
        }
        return arg

      case 'uuid':
        return String(arg)

      case 'unknown':
      default:
        // Default: pass through as-is
        return arg
    }
  })
}

export const ScalarColumnType = {
  BOOL: 16,
  BYTEA: 17,
  CHAR: 18,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  REGPROC: 24,
  TEXT: 25,
  OID: 26,
  TID: 27,
  XID: 28,
  CID: 29,
  JSON: 114,
  XML: 142,
  PG_NODE_TREE: 194,
  SMGR: 210,
  PATH: 602,
  POLYGON: 604,
  CIDR: 650,
  FLOAT4: 700,
  FLOAT8: 701,
  ABSTIME: 702,
  RELTIME: 703,
  TINTERVAL: 704,
  CIRCLE: 718,
  MACADDR8: 774,
  MONEY: 790,
  MACADDR: 829,
  INET: 869,
  ACLITEM: 1033,
  BPCHAR: 1042,
  VARCHAR: 1043,
  DATE: 1082,
  TIME: 1083,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  INTERVAL: 1186,
  TIMETZ: 1266,
  BIT: 1560,
  VARBIT: 1562,
  NUMERIC: 1700,
  REFCURSOR: 1790,
  REGPROCEDURE: 2202,
  REGOPER: 2203,
  REGOPERATOR: 2204,
  REGCLASS: 2205,
  REGTYPE: 2206,
  UUID: 2950,
  TXID_SNAPSHOT: 2970,
  PG_LSN: 3220,
  PG_NDISTINCT: 3361,
  PG_DEPENDENCIES: 3402,
  TSVECTOR: 3614,
  TSQUERY: 3615,
  GTSVECTOR: 3642,
  REGCONFIG: 3734,
  REGDICTIONARY: 3769,
  JSONB: 3802,
  REGNAMESPACE: 4089,
  REGROLE: 4096,
} as const

/**
 * PostgreSQL array column types (not defined in ScalarColumnType).
 *
 * See the semantics of each of this code in:
 *   https://github.com/postgres/postgres/blob/master/src/include/catalog/pg_type.dat
 */
export const ArrayColumnType = {
  BIT_ARRAY: 1561,
  BOOL_ARRAY: 1000,
  BYTEA_ARRAY: 1001,
  BPCHAR_ARRAY: 1014,
  CHAR_ARRAY: 1002,
  CIDR_ARRAY: 651,
  DATE_ARRAY: 1182,
  FLOAT4_ARRAY: 1021,
  FLOAT8_ARRAY: 1022,
  INET_ARRAY: 1041,
  INT2_ARRAY: 1005,
  INT4_ARRAY: 1007,
  INT8_ARRAY: 1016,
  JSONB_ARRAY: 3807,
  JSON_ARRAY: 199,
  MONEY_ARRAY: 791,
  NUMERIC_ARRAY: 1231,
  OID_ARRAY: 1028,
  TEXT_ARRAY: 1009,
  TIMESTAMP_ARRAY: 1115,
  TIMESTAMPTZ_ARRAY: 1185,
  TIME_ARRAY: 1183,
  UUID_ARRAY: 2951,
  VARBIT_ARRAY: 1563,
  VARCHAR_ARRAY: 1015,
  XML_ARRAY: 143,
} as const

export function fieldToColumnType(fieldTypeId: number): ColumnType {
  switch (fieldTypeId) {
    case ScalarColumnType.INT2:
    case ScalarColumnType.INT4:
      return ColumnTypeEnum.Int32
    case ScalarColumnType.INT8:
      return ColumnTypeEnum.Int64
    case ScalarColumnType.FLOAT4:
      return ColumnTypeEnum.Float
    case ScalarColumnType.FLOAT8:
      return ColumnTypeEnum.Double
    case ScalarColumnType.BOOL:
      return ColumnTypeEnum.Boolean
    case ScalarColumnType.DATE:
      return ColumnTypeEnum.Date
    case ScalarColumnType.TIME:
    case ScalarColumnType.TIMETZ:
      return ColumnTypeEnum.Time
    case ScalarColumnType.TIMESTAMP:
    case ScalarColumnType.TIMESTAMPTZ:
      return ColumnTypeEnum.DateTime
    case ScalarColumnType.NUMERIC:
    case ScalarColumnType.MONEY:
      return ColumnTypeEnum.Numeric
    case ScalarColumnType.JSON:
    case ScalarColumnType.JSONB:
      return ColumnTypeEnum.Json
    case ScalarColumnType.UUID:
      return ColumnTypeEnum.Uuid
    case ScalarColumnType.OID:
      return ColumnTypeEnum.Int64
    case ScalarColumnType.BPCHAR:
    case ScalarColumnType.TEXT:
    case ScalarColumnType.VARCHAR:
    case ScalarColumnType.BIT:
    case ScalarColumnType.VARBIT:
    case ScalarColumnType.INET:
    case ScalarColumnType.CIDR:
    case ScalarColumnType.XML:
      return ColumnTypeEnum.Text
    case ScalarColumnType.BYTEA:
      return ColumnTypeEnum.Bytes
    case ArrayColumnType.INT2_ARRAY:
    case ArrayColumnType.INT4_ARRAY:
      return ColumnTypeEnum.Int32Array
    case ArrayColumnType.FLOAT4_ARRAY:
      return ColumnTypeEnum.FloatArray
    case ArrayColumnType.FLOAT8_ARRAY:
      return ColumnTypeEnum.DoubleArray
    case ArrayColumnType.NUMERIC_ARRAY:
    case ArrayColumnType.MONEY_ARRAY:
      return ColumnTypeEnum.NumericArray
    case ArrayColumnType.BOOL_ARRAY:
      return ColumnTypeEnum.BooleanArray
    case ArrayColumnType.CHAR_ARRAY:
      return ColumnTypeEnum.CharacterArray
    case ArrayColumnType.BPCHAR_ARRAY:
    case ArrayColumnType.TEXT_ARRAY:
    case ArrayColumnType.VARCHAR_ARRAY:
    case ArrayColumnType.VARBIT_ARRAY:
    case ArrayColumnType.BIT_ARRAY:
    case ArrayColumnType.INET_ARRAY:
    case ArrayColumnType.CIDR_ARRAY:
    case ArrayColumnType.XML_ARRAY:
      return ColumnTypeEnum.TextArray
    case ArrayColumnType.DATE_ARRAY:
      return ColumnTypeEnum.DateArray
    case ArrayColumnType.TIME_ARRAY:
      return ColumnTypeEnum.TimeArray
    case ArrayColumnType.TIMESTAMP_ARRAY:
      return ColumnTypeEnum.DateTimeArray
    case ArrayColumnType.JSON_ARRAY:
    case ArrayColumnType.JSONB_ARRAY:
      return ColumnTypeEnum.JsonArray
    case ArrayColumnType.BYTEA_ARRAY:
      return ColumnTypeEnum.BytesArray
    case ArrayColumnType.UUID_ARRAY:
      return ColumnTypeEnum.UuidArray
    case ArrayColumnType.INT8_ARRAY:
    case ArrayColumnType.OID_ARRAY:
      return ColumnTypeEnum.Int64Array
    default:
      // Postgres custom types (types that come from extensions and user's enums).
      // We don't use `ColumnTypeEnum.Enum` for enums here and defer the decision to
      // the serializer in QE because it has access to the query schema, while on
      // this level we would have to query the catalog to introspect the type.
      if (fieldTypeId >= 10_000) {
        return ColumnTypeEnum.Text
      }
      throw new UnsupportedNativeDataType(fieldTypeId)
  }
}

export class UnsupportedNativeDataType extends Error {
  constructor(code: number) {
    super(`Unsupported column type id ${code}`)
  }
}

export const builtinParsers = Object.entries({
  [ScalarColumnType.BOOL]: normalize_bool,
  [ScalarColumnType.NUMERIC]: normalize_numeric,
  [ArrayColumnType.NUMERIC_ARRAY]: normalize_array(normalize_numeric),
  [ScalarColumnType.TIME]: normalize_time,
  [ArrayColumnType.TIME_ARRAY]: normalize_array(normalize_time),
  [ScalarColumnType.TIMETZ]: normalize_timez,
  [ScalarColumnType.DATE]: normalize_date,
  [ArrayColumnType.DATE_ARRAY]: normalize_array(normalize_date),
  [ScalarColumnType.TIMESTAMP]: normalize_timestamp,
  [ArrayColumnType.TIMESTAMP_ARRAY]: normalize_array(normalize_timestamp),
  [ScalarColumnType.TIMESTAMPTZ]: normalize_timestamptz,
  [ArrayColumnType.TIMESTAMPTZ_ARRAY]: normalize_array(normalize_timestamptz),
  [ScalarColumnType.MONEY]: normalize_money,
  [ArrayColumnType.MONEY_ARRAY]: normalize_array(normalize_money),
  [ScalarColumnType.JSON]: toJson,
  [ArrayColumnType.JSON_ARRAY]: normalize_array(toJson),
  [ScalarColumnType.JSONB]: toJson,
  [ArrayColumnType.JSONB_ARRAY]: normalize_array(toJson),
  [ScalarColumnType.BYTEA]: convertBytes,
  [ArrayColumnType.BYTEA_ARRAY]: normalizeByteaArray,
  [ArrayColumnType.BIT_ARRAY]: normalize_array(normalizeBit),
  [ArrayColumnType.VARBIT_ARRAY]: normalize_array(normalizeBit),
  [ArrayColumnType.XML_ARRAY]: normalize_array(normalize_xml),
}).map(([k, v]) => ({
  oid: Number(k),
  parse: v,
}))

function normalize_bool(x: string | null) {
  return x === null ? null : x === 'f' ? 'false' : 'true'
}

function normalize_array(
  element_normalizer: (x: string) => string | null,
): (str: string | null) => (string | null)[] | null {
  return (str) => {
    if (str === null) return null
    return parseArray(str, element_normalizer)
  }
}

/****************************/
/* Time-related data-types  */
/****************************/

function normalize_numeric(numeric: string): string {
  return numeric
}

/****************************/
/* Time-related data-types  */
/****************************/

/*
 * DATE, DATE_ARRAY - converts value (or value elements) to a string in the format YYYY-MM-DD
 */

function normalize_date(date: string): string {
  return date
}

/*
 * TIMESTAMP, TIMESTAMP_ARRAY - converts value (or value elements) to a string in the rfc3339 format
 * ex: 1996-12-19T16:39:57-08:00
 */

function normalize_timestamp(time: string | null): string | null {
  if (time === null) return null
  return normalizeTimestamp(time)
}

function normalize_timestamptz(time: string | null): string | null {
  if (time === null) return null
  return normalizeTimestamptz(time)
}

/*
 * TIME, TIMETZ, TIME_ARRAY - converts value (or value elements) to a string in the format HH:mm:ss.f
 */

function normalize_time(time: string): string {
  return time
}

function normalize_timez(time: string | null): string | null {
  if (time === null) return null
  // Although it might be controversial, UTC is assumed in consistency with the behavior of rust postgres driver
  // in quaint. See quaint/src/connector/postgres/conversion.rs
  return time.replace(/[+-]\d{2}(:\d{2})?$/, '')
}

/******************/
/* Money handling */
/******************/

function normalize_money(money: string | null): string | null {
  if (money === null) return null
  return money.slice(1)
}

/******************/
/* XML handling */
/******************/
function normalize_xml(xml: string): string {
  return xml
}

/*****************/
/* JSON handling */
/*****************/

/**
 * We hand off JSON handling entirely to engines, so we keep it
 * stringified here. This function needs to exist as otherwise
 * the default type parser attempts to deserialise it.
 */
function toJson(json: string): string {
  return json
}

/************************/
/* Binary data handling */
/************************/

/*
 * BYTEA - arbitrary raw binary strings
 * the PPG client uses base64 in this case. We do not convert the array of bytea, though (see below)
 */
function parsePgBytes(x: string): Buffer {
  return Buffer.from(x, 'base64')
}

const builtInByteParser = getTypeParser(ScalarColumnType.BYTEA) as (_: string) => Buffer
/*
 * BYTEA_ARRAY - arrays of arbitrary raw binary strings
 */
function normalizeByteaArray(x: string | null): (Buffer | null)[] | null {
  if (x === null) return null
  return parseArray(x).map((elem) => (elem === null ? null : builtInByteParser(elem)))
}

function convertBytes(serializedBytes: string | null): Buffer | null {
  if (serializedBytes === null) return null
  return parsePgBytes(serializedBytes)
}

/* BIT_ARRAY, VARBIT_ARRAY */

function normalizeBit(bit: string): string {
  return bit
}
