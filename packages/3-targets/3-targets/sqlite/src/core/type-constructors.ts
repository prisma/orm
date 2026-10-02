import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from './codec-ids';

/**
 * The base PSL scalars as zero-arg type constructors in the unified authoring
 * channel. Each names a codec; the column's database type is its data type's.
 *
 * The type position is the only storage decider: a mutation-default generator
 * (`@default(uuid())`) never re-picks a column's storage.
 *
 * Defined here, next to the codecs they name, but the adapter contributes them: the TypeScript contract builder builds its `type.*` helpers from the target, so a target contribution would add `type.String()` and the like there.
 */
export const sqliteScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    documentation: 'Variable-length text stored as SQLite text.',
    output: { codecId: SQLITE_TEXT_CODEC_ID },
  },
  Int: {
    kind: 'typeConstructor',
    documentation: 'An integer stored as SQLite integer and represented as a JavaScript number.',
    output: { codecId: SQLITE_INTEGER_CODEC_ID },
  },
  BigInt: {
    kind: 'typeConstructor',
    documentation: 'An integer stored as SQLite integer and represented as a JavaScript bigint.',
    output: { codecId: SQLITE_BIGINT_CODEC_ID },
  },
  Float: {
    kind: 'typeConstructor',
    documentation: 'A floating-point number stored as SQLite real.',
    output: { codecId: SQLITE_REAL_CODEC_ID },
  },
  Decimal: {
    kind: 'typeConstructor',
    documentation: 'A decimal value stored and represented as text to preserve precision.',
    output: { codecId: SQLITE_TEXT_CODEC_ID },
  },
  DateTime: {
    kind: 'typeConstructor',
    documentation: 'A date and time stored as SQLite text.',
    output: { codecId: SQLITE_DATETIME_CODEC_ID },
  },
  Json: {
    kind: 'typeConstructor',
    documentation: 'A JSON value serialized to SQLite text.',
    output: { codecId: SQLITE_JSON_CODEC_ID },
  },
  Bytes: {
    kind: 'typeConstructor',
    documentation: 'Binary data stored as a SQLite blob.',
    output: { codecId: SQLITE_BLOB_CODEC_ID },
  },
} as const satisfies AuthoringTypeNamespace;
