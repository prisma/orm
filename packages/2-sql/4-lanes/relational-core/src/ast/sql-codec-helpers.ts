/**
 * Shared encode/decode/render constants and codec id literals for the five SQL base codecs (`sql/char@1`, `sql/varchar@1`, `sql/int@1`, `sql/float@1`, `sql/text@1`).
 *
 * The codec implementations live in `sql-codecs.ts` (TML-2357). This module retains only the conversion helpers + emit-path renderers the codec methods compose with — keeping a single source of truth for non-trivial conversions while the codec methods provide the framework-required `Promise<…>` boundary.
 */

import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';

export const SQL_CHAR_CODEC_ID = 'sql/char@1' as const;
export const SQL_VARCHAR_CODEC_ID = 'sql/varchar@1' as const;
export const SQL_INT_CODEC_ID = 'sql/int@1' as const;
export const SQL_FLOAT_CODEC_ID = 'sql/float@1' as const;
export const SQL_TEXT_CODEC_ID = 'sql/text@1' as const;

export const sqlCharEncode = (value: string): string => value;
export const sqlCharDecode = (wire: string): string => wire.trimEnd();
export const sqlCharRenderOutputType = (typeParams: { readonly length?: number }) => {
  const length = typeParams.length;
  if (length === undefined) return undefined;
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw structuredError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `renderOutputType: expected integer "length" in typeParams for Char, got ${String(length)}`,
      { meta: { codec: SQL_CHAR_CODEC_ID, param: 'length', received: String(length) } },
    );
  }
  return `Char<${length}>`;
};

export const sqlVarcharEncode = (value: string): string => value;
export const sqlVarcharDecode = (wire: string): string => wire;
export const sqlVarcharRenderOutputType = (typeParams: { readonly length?: number }) => {
  const length = typeParams.length;
  if (length === undefined) return undefined;
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw structuredError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `renderOutputType: expected integer "length" in typeParams for Varchar, got ${String(length)}`,
      { meta: { codec: SQL_VARCHAR_CODEC_ID, param: 'length', received: String(length) } },
    );
  }
  return `Varchar<${length}>`;
};

export const sqlIntEncode = (value: number): number => value;
export const sqlIntDecode = (wire: number): number => wire;

export const sqlFloatEncode = (value: number): number => value;
export const sqlFloatDecode = (wire: number): number => wire;

/**
 * JSON has no spelling for a non-finite number, and a database that holds one
 * emits it as a string — PostgreSQL writes `"NaN"` and `"Infinity"`. This
 * codec's application type is `number`, so both directions reject rather than
 * carry a value that type cannot hold.
 */
export const sqlFloatEncodeJson = (value: number): JsonValue => {
  if (!Number.isFinite(value)) {
    throw structuredError(
      'RUNTIME.ENCODE_FAILED',
      `${SQL_FLOAT_CODEC_ID} application value must be a finite number, got ${value}`,
      { meta: { codec: SQL_FLOAT_CODEC_ID } },
    );
  }
  return value;
};

export const sqlFloatDecodeJson = (json: JsonValue): number => {
  if (typeof json !== 'number' || !Number.isFinite(json)) {
    throw structuredError(
      'RUNTIME.DECODE_FAILED',
      `Expected a finite number for ${SQL_FLOAT_CODEC_ID}, got ${JSON.stringify(json)}`,
      { meta: { codec: SQL_FLOAT_CODEC_ID } },
    );
  }
  return json;
};

export const sqlTextEncode = (value: string): string => value;
export const sqlTextDecode = (wire: string): string => wire;
