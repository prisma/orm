/**
 * Codec type definitions for the MySQL target. Declared here rather than re-exported, so a downstream `.d.mts` names this entry point instead of a hash-named chunk.
 */

import type { ExtractCodecTypes } from '@internal/sql-relational-core/ast';
import {
  mysqlBigintDescriptor,
  mysqlDatetimeDescriptor,
  mysqlEnumDescriptor,
  mysqlIntDescriptor,
  mysqlSqlCharDescriptor,
  mysqlSqlRawDescriptor,
  mysqlSqlVarcharDescriptor,
  mysqlTextDescriptor,
} from '../core/codecs';
import {
  mysqlDateStringDescriptor,
  mysqlDateTemporalDescriptor,
  mysqlDatetimeStringDescriptor,
  mysqlDatetimeTemporalDescriptor,
  mysqlDurationStringDescriptor,
  mysqlTimeStringDescriptor,
  mysqlTimestampDateDescriptor,
  mysqlTimestampStringDescriptor,
  mysqlTimestampTemporalDescriptor,
  mysqlTimeTemporalDescriptor,
} from '../core/date-time-codecs';

const codecDescriptorMap = {
  char: mysqlSqlCharDescriptor,
  varchar: mysqlSqlVarcharDescriptor,
  raw: mysqlSqlRawDescriptor,
  text: mysqlTextDescriptor,
  int: mysqlIntDescriptor,
  bigint: mysqlBigintDescriptor,
  datetime: mysqlDatetimeDescriptor,
  'datetime-temporal': mysqlDatetimeTemporalDescriptor,
  'datetime-string': mysqlDatetimeStringDescriptor,
  'timestamp-date': mysqlTimestampDateDescriptor,
  'timestamp-temporal': mysqlTimestampTemporalDescriptor,
  'timestamp-string': mysqlTimestampStringDescriptor,
  'date-string': mysqlDateStringDescriptor,
  'date-temporal': mysqlDateTemporalDescriptor,
  'time-string': mysqlTimeStringDescriptor,
  'time-temporal': mysqlTimeTemporalDescriptor,
  'duration-string': mysqlDurationStringDescriptor,
  enum: mysqlEnumDescriptor,
} as const;

type Resolve<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: T[K][P] } };

export type CodecTypes = Resolve<ExtractCodecTypes<typeof codecDescriptorMap>>;
