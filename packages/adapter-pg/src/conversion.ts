import { ArgType, type ColumnType, ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import pg from 'pg'
import { parse as parseArray } from 'postgres-array'

import { FIRST_NORMAL_OBJECT_ID } from './constants'

const { types } = pg
const { builtins: ScalarColumnType, getTypeParser } = types

/**
 * Additional scalar column types not defined in `pg` types builtins.
 */
const AdditionalScalarColumnType = {
  NAME: 19,
}

/**
 * PostgreSQL array column types (not defined in ScalarColumnType).
 *
 * See the semantics of each of this code in:
 *   https://github.com/postgres/postgres/blob/master/src/include/catalog/pg_type.dat
 */
const ArrayColumnType = {
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
}

export class UnsupportedNativeDataType extends Error {
  // map of type codes to type names
  static typeNames: { [key: number]: string } = {
    16: 'bool',
    17: 'bytea',
    18: 'char',
    19: 'name',
    20: 'int8',
    21: 'int2',
    22: 'int2vector',
    23: 'int4',
    24: 'regproc',
    25: 'text',
    26: 'oid',
    27: 'tid',
    28: 'xid',
    29: 'cid',
    30: 'oidvector',
    32: 'pg_ddl_command',
    71: 'pg_type',
    75: 'pg_attribute',
    81: 'pg_proc',
    83: 'pg_class',
    114: 'json',
    142: 'xml',
    194: 'pg_node_tree',
    269: 'table_am_handler',
    325: 'index_am_handler',
    600: 'point',
    601: 'lseg',
    602: 'path',
    603: 'box',
    604: 'polygon',
    628: 'line',
    650: 'cidr',
    700: 'float4',
    701: 'float8',
    705: 'unknown',
    718: 'circle',
    774: 'macaddr8',
    790: 'money',
    829: 'macaddr',
    869: 'inet',
    1033: 'aclitem',
    1042: 'bpchar',
    1043: 'varchar',
    1082: 'date',
    1083: 'time',
    1114: 'timestamp',
    1184: 'timestamptz',
    1186: 'interval',
    1266: 'timetz',
    1560: 'bit',
    1562: 'varbit',
    1700: 'numeric',
    1790: 'refcursor',
    2202: 'regprocedure',
    2203: 'regoper',
    2204: 'regoperator',
    2205: 'regclass',
    2206: 'regtype',
    2249: 'record',
    2275: 'cstring',
    2276: 'any',
    2277: 'anyarray',
    2278: 'void',
    2279: 'trigger',
    2280: 'language_handler',
    2281: 'internal',
    2283: 'anyelement',
    2287: '_record',
    2776: 'anynonarray',
    2950: 'uuid',
    2970: 'txid_snapshot',
    3115: 'fdw_handler',
    3220: 'pg_lsn',
    3310: 'tsm_handler',
    3361: 'pg_ndistinct',
    3402: 'pg_dependencies',
    3500: 'anyenum',
    3614: 'tsvector',
    3615: 'tsquery',
    3642: 'gtsvector',
    3734: 'regconfig',
    3769: 'regdictionary',
    3802: 'jsonb',
    3831: 'anyrange',
    3838: 'event_trigger',
    3904: 'int4range',
    3906: 'numrange',
    3908: 'tsrange',
    3910: 'tstzrange',
    3912: 'daterange',
    3926: 'int8range',
    4072: 'jsonpath',
    4089: 'regnamespace',
    4096: 'regrole',
    4191: 'regcollation',
    4451: 'int4multirange',
    4532: 'nummultirange',
    4533: 'tsmultirange',
    4534: 'tstzmultirange',
    4535: 'datemultirange',
    4536: 'int8multirange',
    4537: 'anymultirange',
    4538: 'anycompatiblemultirange',
    4600: 'pg_brin_bloom_summary',
    4601: 'pg_brin_minmax_multi_summary',
    5017: 'pg_mcv_list',
    5038: 'pg_snapshot',
    5069: 'xid8',
    5077: 'anycompatible',
    5078: 'anycompatiblearray',
    5079: 'anycompatiblenonarray',
    5080: 'anycompatiblerange',
  }

  type: string

  constructor(code: number) {
    super()
    this.type = UnsupportedNativeDataType.typeNames[code] || 'Unknown'
    this.message = `Unsupported column type ${this.type}`
  }
}

/**
 * This is a simplification of quaint's value inference logic. Take a look at quaint's conversion.rs
 * module to see how other attributes of the field packet such as the field length are used to infer
 * the correct quaint::Value variant.
 */
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
    case AdditionalScalarColumnType.NAME:
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
    case ArrayColumnType.TIMESTAMPTZ_ARRAY:
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
      if (fieldTypeId >= FIRST_NORMAL_OBJECT_ID) {
        return ColumnTypeEnum.Text
      }
      throw new UnsupportedNativeDataType(fieldTypeId)
  }
}

function normalize_array(element_normalizer: (string) => string): (string) => string[] {
  return (str) => parseArray(str, element_normalizer)
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

function normalize_timestamp(time: string): string {
  return `${time.replace(' ', 'T')}+00:00`
}

function normalize_timestamptz(time: string): string {
  // PostgreSQL returns TIMESTAMPTZ values in the session timezone (e.g. '2024-01-01 09:26:34-06').
  // We must convert to UTC rather than merely swapping the offset label.
  const withSeparator = time.replace(' ', 'T')
  // Normalise bare hour offsets (e.g. '-06') and hour-with-seconds offsets
  // (e.g. '+05:53:20', emitted for LMT-era historical timezones) to ±HH:MM so
  // that Date.parse can handle them. The seconds component is dropped because
  // JS Date does not support sub-minute offsets and the fractional-second error
  // is negligible for real-world timestamps.
  const withFullOffset = withSeparator
    .replace(/([+-]\d{2}):(\d{2}):\d{2}$/, '$1:$2')
    .replace(/([+-]\d{2})$/, '$1:00')
  // JavaScript Date only handles millisecond (3-digit) precision. Extract any extra fractional
  // digits and reattach after conversion — fractional seconds are unchanged by a timezone shift.
  const fracMatch = withFullOffset.match(/\.(\d{4,})/)
  if (fracMatch) {
    const fullFrac = fracMatch[1]
    const trimmed = withFullOffset.replace(/\.(\d{4,})/, '.' + fullFrac.slice(0, 3))
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) {
      return d.toISOString().replace(/\.\d{3}Z$/, '.' + fullFrac + '+00:00')
    }
  } else {
    const d = new Date(withFullOffset)
    if (!isNaN(d.getTime())) {
      return d.toISOString().replace(/Z$/, '+00:00')
    }
  }
  // Fallback for any input that Date.parse cannot handle: preserve the
  // original string with the separator normalised to 'T' and the offset
  // label rewritten to '+00:00'. This matches the old behaviour and avoids
  // a thrown RangeError propagating to the caller.
  return withSeparator.replace(/[+-]\d{2}(:\d{2})?(:\d{2})?$/, '+00:00')
}

/*
 * TIME, TIMETZ, TIME_ARRAY - converts value (or value elements) to a string in the format HH:mm:ss.f
 */

function normalize_time(time: string): string {
  return time
}

function normalize_timez(time: string): string {
  // Although it might be controversial, UTC is assumed in consistency with the behavior of rust postgres driver
  // in quaint. See quaint/src/connector/postgres/conversion.rs
  return time.replace(/[+-]\d{2}(:\d{2})?$/, '')
}

/******************/
/* Money handling */
/******************/

function normalize_money(money: string): string {
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
 */

const parsePgBytes = getTypeParser(ScalarColumnType.BYTEA) as (_: string) => Buffer

/*
 * BYTEA_ARRAY - arrays of arbitrary raw binary strings
 */

const normalizeByteaArray = getTypeParser(ArrayColumnType.BYTEA_ARRAY) as (_: string) => Buffer[]

function convertBytes(serializedBytes: string): Buffer {
  return parsePgBytes(serializedBytes)
}

/* BIT_ARRAY, VARBIT_ARRAY */

function normalizeBit(bit: string): string {
  return bit
}

export const customParsers = {
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
}

export function mapArg<A>(arg: A | Date, argType: ArgType): null | unknown[] | string | Uint8Array | A {
  if (arg === null) {
    return null
  }

  if (Array.isArray(arg) && argType.arity === 'list') {
    return arg.map((value) => mapArg(value, argType))
  }

  if (typeof arg === 'string' && argType.scalarType === 'datetime') {
    arg = new Date(arg)
  }

  if (arg instanceof Date) {
    switch (argType.dbType) {
      case 'TIME':
      case 'TIMETZ':
        return formatTime(arg)
      case 'DATE':
        return formatDate(arg)
      default:
        return formatDateTime(arg)
    }
  }

  if (typeof arg === 'string' && argType.scalarType === 'bytes') {
    return Buffer.from(arg, 'base64')
  }

  // https://github.com/brianc/node-postgres/pull/2930
  if (ArrayBuffer.isView(arg)) {
    return new Uint8Array(arg.buffer, arg.byteOffset, arg.byteLength)
  }

  return arg
}

function formatDateTime(date: Date): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, '0')
  const ms = date.getUTCMilliseconds()
  // The '+00:00' suffix tells PostgreSQL that the value is UTC.
  // For TIMESTAMP WITHOUT TIME ZONE columns PostgreSQL silently ignores the offset,
  // so this suffix is a safe no-op for those columns while being critical for TIMESTAMPTZ
  // columns when the database server is not running in the UTC timezone.
  // See: https://github.com/prisma/prisma/issues/28629
  return (
    pad(date.getUTCFullYear(), 4) +
    '-' +
    pad(date.getUTCMonth() + 1) +
    '-' +
    pad(date.getUTCDate()) +
    ' ' +
    pad(date.getUTCHours()) +
    ':' +
    pad(date.getUTCMinutes()) +
    ':' +
    pad(date.getUTCSeconds()) +
    (ms ? '.' + String(ms).padStart(3, '0') : '') +
    '+00:00'
  )
}

function formatDate(date: Date): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, '0')
  return pad(date.getUTCFullYear(), 4) + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate())
}

function formatTime(date: Date): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, '0')
  const ms = date.getUTCMilliseconds()
  return (
    pad(date.getUTCHours()) +
    ':' +
    pad(date.getUTCMinutes()) +
    ':' +
    pad(date.getUTCSeconds()) +
    (ms ? '.' + String(ms).padStart(3, '0') : '')
  )
}
