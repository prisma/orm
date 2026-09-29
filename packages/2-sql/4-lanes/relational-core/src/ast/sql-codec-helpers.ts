/**
 * Shared encode/decode/render constants and codec id literals for the five SQL base codecs (`sql/char@1`, `sql/varchar@1`, `sql/int@1`, `sql/float@1`, `sql/text@1`).
 *
 * The codec implementations live in `sql-codecs.ts` (TML-2357). This module retains only the conversion helpers + emit-path renderers the codec methods compose with — keeping a single source of truth for non-trivial conversions while the codec methods provide the framework-required `Promise<…>` boundary.
 */

import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';
import { isNonFiniteText } from './data-type-support';

export const SQL_CHAR_CODEC_ID = 'sql/char@1' as const;
export const SQL_VARCHAR_CODEC_ID = 'sql/varchar@1' as const;
export const SQL_INT_CODEC_ID = 'sql/int@1' as const;
export const SQL_FLOAT_CODEC_ID = 'sql/float@1' as const;
export const SQL_TEXT_CODEC_ID = 'sql/text@1' as const;

/** Reads a JSON value a codec stores as a string, refusing any other kind. */
export const sqlStringDecodeJson = (codecId: string, json: JsonValue): string => {
  if (typeof json !== 'string') {
    throw structuredError(
      'RUNTIME.DECODE_FAILED',
      `${codecId} database JSON value must be a string`,
      {
        meta: { codecId, received: typeof json },
      },
    );
  }
  return json;
};

/** Reads a JSON integer a JavaScript `number` holds exactly. */
export const sqlIntegerDecodeJson = (codecId: string, json: JsonValue): number => {
  if (typeof json !== 'number' || !Number.isSafeInteger(json)) {
    throw structuredError(
      'RUNTIME.DECODE_FAILED',
      `${codecId} database JSON value must be an integer within the safe integer range`,
      { meta: { codecId, received: typeof json === 'number' ? json : typeof json } },
    );
  }
  return json;
};

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
 * JSON has no spelling for a non-finite number, so a float codec stores NaN and the infinities as
 * the text PostgreSQL writes for them in JSON: `"NaN"`, `"Infinity"`, `"-Infinity"`.
 */
export const sqlFloatEncodeJson = (value: number): JsonValue =>
  Number.isFinite(value) ? value : String(value);

/**
 * Reads a float's stored JSON: a number, or the text PostgreSQL writes for NaN and the infinities.
 * SQLite writes an infinity as `9.0e+999`, which `JSON.parse` reads as a number.
 */
export const sqlFloatDecodeJson = (codecId: string, json: JsonValue): number => {
  if (typeof json === 'number') return json;
  if (typeof json === 'string' && isNonFiniteText(json)) return Number(json);
  throw structuredError(
    'RUNTIME.DECODE_FAILED',
    `${codecId} database JSON value must be a number or the text NaN, Infinity or -Infinity`,
    { meta: { codecId, received: typeof json } },
  );
};

export const sqlTextEncode = (value: string): string => value;
export const sqlTextDecode = (wire: string): string => wire;
