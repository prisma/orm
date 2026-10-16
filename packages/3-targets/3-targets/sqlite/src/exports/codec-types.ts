/**
 * Codec type definitions for the SQLite target.
 *
 * Defining `CodecTypes` here (rather than re-exporting from `core/codecs`) keeps the tsdown DTS bundler from emitting a private chunk path in downstream `.d.mts` files: consumers see `CodecTypes` resolved via this public entry point rather than via a hash-named internal chunk (TML-2357).
 */

import type { ExtractCodecTypes } from '@internal/sql-relational-core/ast';
import type { JsonValue } from '../core/codec-helpers';
import {
  sqliteBigintDescriptor,
  sqliteBigintNumberDescriptor,
  sqliteBlobDescriptor,
  sqliteDatetimeDescriptor,
  sqliteIntegerDescriptor,
  sqliteJsonDescriptor,
  sqliteRealDescriptor,
  sqliteSqlCharDescriptor,
  sqliteSqlFloatDescriptor,
  sqliteSqlIntDescriptor,
  sqliteSqlRawDescriptor,
  sqliteSqlVarcharDescriptor,
  sqliteTextDescriptor,
} from '../core/codecs';

const codecDescriptorMap = {
  char: sqliteSqlCharDescriptor,
  varchar: sqliteSqlVarcharDescriptor,
  int: sqliteSqlIntDescriptor,
  float: sqliteSqlFloatDescriptor,
  text: sqliteTextDescriptor,
  integer: sqliteIntegerDescriptor,
  real: sqliteRealDescriptor,
  blob: sqliteBlobDescriptor,
  datetime: sqliteDatetimeDescriptor,
  json: sqliteJsonDescriptor,
  bigint: sqliteBigintDescriptor,
  bigintnumber: sqliteBigintNumberDescriptor,
  raw: sqliteSqlRawDescriptor,
} as const;

type Resolve<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: T[K][P] } };

export type CodecTypes = Resolve<ExtractCodecTypes<typeof codecDescriptorMap>>;

export type { JsonValue };
