/**
 * Internal codec descriptor map and `CodecTypes` materialisation for the Postgres target.
 *
 * Why this lives in `core/` even though the public origin of `CodecTypes` is `exports/codec-types.ts`:
 *
 * - The descriptor map (`codecDescriptorMap`) and the `Resolve<T>` helper are implementation detail; they shouldn't appear on the public package surface.
 * - The `CodecTypes` *materialisation* (the `Resolve<...>` application) must still happen at the public boundary so tsdown's DTS bundler resolves consumer-side `pack.d.mts` references via the public entry point rather than a hash-named internal chunk (the `TS2742` family). `exports/codec-types.ts` re-exports `CodecTypes` from here as a type alias, which preserves the materialisation site at the public surface.
 */

import type { ExtractCodecTypes } from '@internal/sql-relational-core/ast';
import {
  pgBitDescriptor,
  pgBoolDescriptor,
  pgByteaDescriptor,
  pgCharDescriptor,
  pgDateDescriptor,
  pgDateStringDescriptor,
  pgEnumDescriptor,
  pgFloat4Descriptor,
  pgFloat8Descriptor,
  pgFloatDescriptor,
  pgInetDescriptor,
  pgInt2Descriptor,
  pgInt4Descriptor,
  pgInt8Descriptor,
  pgInt8NumberDescriptor,
  pgIntDescriptor,
  pgIntervalDescriptor,
  pgJsonbDescriptor,
  pgJsonDescriptor,
  pgNumericDescriptor,
  pgTextDescriptor,
  pgTimeDescriptor,
  pgTimeStringDescriptor,
  pgTimestampDescriptor,
  pgTimestampStringDescriptor,
  pgTimestamptzDescriptor,
  pgTimestamptzStringDescriptor,
  pgTimetzDescriptor,
  pgUnboundedIntDescriptor,
  pgUuidDescriptor,
  pgVarbitDescriptor,
  pgVarcharDescriptor,
  postgresSqlCharDescriptor,
  postgresSqlFloatDescriptor,
  postgresSqlIntDescriptor,
  postgresSqlTextDescriptor,
  postgresSqlTimestampDescriptor,
  postgresSqlVarcharDescriptor,
} from './codecs';

export const codecDescriptorMap = {
  char: postgresSqlCharDescriptor,
  varchar: postgresSqlVarcharDescriptor,
  int: postgresSqlIntDescriptor,
  float: postgresSqlFloatDescriptor,
  'sql-text': postgresSqlTextDescriptor,
  'sql-timestamp': postgresSqlTimestampDescriptor,
  text: pgTextDescriptor,
  enum: pgEnumDescriptor,
  character: pgCharDescriptor,
  'character varying': pgVarcharDescriptor,
  integer: pgIntDescriptor,
  'double precision': pgFloatDescriptor,
  int4: pgInt4Descriptor,
  int2: pgInt2Descriptor,
  int8: pgInt8Descriptor,
  int8number: pgInt8NumberDescriptor,
  float4: pgFloat4Descriptor,
  float8: pgFloat8Descriptor,
  numeric: pgNumericDescriptor,
  unboundedint: pgUnboundedIntDescriptor,
  date: pgDateDescriptor,
  timestamp: pgTimestampDescriptor,
  timestamptz: pgTimestamptzDescriptor,
  time: pgTimeDescriptor,
  'date-string': pgDateStringDescriptor,
  'timestamp-string': pgTimestampStringDescriptor,
  'timestamptz-string': pgTimestamptzStringDescriptor,
  'time-string': pgTimeStringDescriptor,
  timetz: pgTimetzDescriptor,
  bool: pgBoolDescriptor,
  bit: pgBitDescriptor,
  'bit varying': pgVarbitDescriptor,
  bytea: pgByteaDescriptor,
  uuid: pgUuidDescriptor,
  inet: pgInetDescriptor,
  interval: pgIntervalDescriptor,
  json: pgJsonDescriptor,
  jsonb: pgJsonbDescriptor,
} as const;

export type Resolve<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: T[K][P] } };

export type CodecDescriptorMap = typeof codecDescriptorMap;

export type ExtractedCodecTypes = ExtractCodecTypes<CodecDescriptorMap>;
