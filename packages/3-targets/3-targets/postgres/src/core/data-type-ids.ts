/**
 * The data types this target owns, one per PostgreSQL type its codecs represent.
 *
 * A codec names one of these and stores that type's canonical form. Several codecs may represent
 * one type: `pg/int8@1` and `pg/int8number@1` both represent `pg/int8` and differ only in the
 * value they produce in memory.
 *
 * ADR 254. These are the ids; the declarations that carry each type's casts follow.
 */

import { dataTypeId } from '@internal/framework-components/codec';

export const PG_TEXT = dataTypeId('pg/text');
export const PG_CHAR = dataTypeId('pg/char');
export const PG_VARCHAR = dataTypeId('pg/varchar');
export const PG_TEXT_ARRAY = dataTypeId('pg/text-array');
export const PG_ENUM = dataTypeId('pg/enum');
export const PG_UUID = dataTypeId('pg/uuid');
export const PG_INET = dataTypeId('pg/inet');
export const PG_BIT = dataTypeId('pg/bit');
export const PG_VARBIT = dataTypeId('pg/varbit');
export const PG_BYTEA = dataTypeId('pg/bytea');
export const PG_INTERVAL = dataTypeId('pg/interval');
export const PG_DATE = dataTypeId('pg/date');
export const PG_TIME = dataTypeId('pg/time');
export const PG_TIMETZ = dataTypeId('pg/timetz');
export const PG_TIMESTAMP = dataTypeId('pg/timestamp');
export const PG_TIMESTAMPTZ = dataTypeId('pg/timestamptz');
export const PG_INT2 = dataTypeId('pg/int2');
export const PG_INT4 = dataTypeId('pg/int4');
export const PG_INT8 = dataTypeId('pg/int8');
export const PG_NUMERIC = dataTypeId('pg/numeric');
export const PG_FLOAT4 = dataTypeId('pg/float4');
export const PG_FLOAT8 = dataTypeId('pg/float8');
export const PG_BOOL = dataTypeId('pg/bool');
export const PG_JSON = dataTypeId('pg/json');
export const PG_JSONB = dataTypeId('pg/jsonb');
