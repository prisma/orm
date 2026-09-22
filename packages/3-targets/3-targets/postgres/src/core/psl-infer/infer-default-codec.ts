/**
 * The codec `contract emit` binds to a printed column, and the data type that codec represents.
 *
 * `contract emit` binds a codec to each PSL type constructor the printer names, so a default has to
 * be written in the form that codec reads back. The binding itself lives in the adapter's authoring
 * type namespaces, which sit above this package; the table below restates it for the type names the
 * printer emits, and `adapter-postgres/test/printed-type-codecs.test.ts` fails if the two disagree
 * or if the printer gains a type name this table does not cover.
 */

import type { ColumnDefaultLiteralInputValue, JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type DataTypeId,
  materializeCodec,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { PG_TEXT_CODEC_ID } from '../codec-ids';
import { postgresCodecDescriptorRegistry } from '../registry';

/** The codec `contract emit` binds to each PSL type name the type map prints. */
export const CODEC_ID_BY_PRINTED_TYPE: ReadonlyMap<string, string> = new Map([
  ['String', 'pg/text@1'],
  ['Boolean', 'pg/bool@1'],
  ['Int', 'pg/int4@1'],
  ['SmallInt', 'pg/int2@1'],
  ['BigInt', 'pg/int8@1'],
  ['Float', 'pg/float8@1'],
  ['Real', 'pg/float4@1'],
  ['Numeric', 'pg/numeric@1'],
  ['Timestamp', 'pg/timestamp-temporal@1'],
  ['Timestamptz', 'pg/timestamptz-temporal@1'],
  ['Date', 'pg/date-temporal@1'],
  ['Time', 'pg/time-temporal@1'],
  ['Timetz', 'pg/timetz@1'],
  ['Json', 'pg/json@1'],
  ['Jsonb', 'pg/jsonb@1'],
  ['Bytes', 'pg/bytea@1'],
  ['Uuid', 'pg/uuid@1'],
  ['Inet', 'pg/inet@1'],
  ['VarChar', 'sql/varchar@1'],
  ['Char', 'sql/char@1'],
]);

/**
 * The data type a column of `pslTypeName` holds values of, which is the one its codec represents.
 * An enum column's default is a member name, which is text either way, so it reads through the text
 * codec.
 */
export function dataTypeForPrintedType(
  pslTypeName: string,
  isEnum: boolean,
): DataTypeId | undefined {
  const codecId = isEnum ? PG_TEXT_CODEC_ID : CODEC_ID_BY_PRINTED_TYPE.get(pslTypeName);
  if (codecId === undefined) return undefined;
  return postgresCodecDescriptorRegistry.descriptorFor(codecId)?.dataType;
}

const codecs = new Map<string, Codec>();

/** One instance per codec id: every codec in the table above decodes JSON the same way for any params. */
function printedTypeCodec(pslTypeName: string, isEnum: boolean): Codec | undefined {
  const codecId = isEnum ? PG_TEXT_CODEC_ID : CODEC_ID_BY_PRINTED_TYPE.get(pslTypeName);
  if (codecId === undefined) return undefined;
  const cached = codecs.get(codecId);
  if (cached !== undefined) return cached;
  const descriptor = postgresCodecDescriptorRegistry.descriptorFor(codecId);
  if (descriptor === undefined) return undefined;
  const codec = materializeCodec(descriptor, { codecId }, { name: `<infer:${codecId}>` });
  codecs.set(codecId, codec);
  return codec;
}

/**
 * Whether the column's codec reads the value back.
 *
 * A data type says which values its column takes, not that every codec of it accepts each one: the
 * temporal codecs represent types that cast from text but refuse `infinity`, which PostgreSQL
 * stores and reports verbatim. A default the codec refuses has no PSL literal, so the raw
 * expression prints instead of a schema `contract emit` would reject.
 */
export function printedDefaultReadsBack(
  value: ColumnDefaultLiteralInputValue,
  pslTypeName: string,
  isEnum: boolean,
  isList: boolean,
): boolean {
  const codec = printedTypeCodec(pslTypeName, isEnum);
  if (codec === undefined) return false;
  const values = isList && Array.isArray(value) ? value : [value];
  return values.every((element) => {
    try {
      codec.decodeJson(blindCast<JsonValue, 'a stored literal default is JSON'>(element));
      return true;
    } catch {
      return false;
    }
  });
}
