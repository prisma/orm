/**
 * Pure JSON-to-TypeScript-source printer.
 *
 * This module is the second stage of the codec → TS pipeline:
 *
 *     jsValue  →  codec.toDataTypeValue  →  JsonValue  →  jsonToTsSource  →  TS source text
 *
 * Stage 1 (`codec.toDataTypeValue`, whose value holds the stored JSON) is a codec and data type responsibility — date serialization,
 * opaque domain types (vector, bigint, uuid), JSON canonicalization. Stage 2
 * (this module) is a pure JSON-to-TS printer that must never grow type-specific
 * branches.
 *
 * To render a non-JSON JS value (Date, Vector, BigInt, Buffer, …), encode it
 * through the relevant codec's `toDataTypeValue` first. Adding special cases to
 * this file is not the answer — that's what codecs are for.
 *
 * The file also exports `tsObjectSource` and `tsArraySource`, the object and
 * array layouts `jsonToTsSource` uses, for callers that render some values
 * themselves.
 */

import { InternalError } from '@internal/utils/internal-error';
import { tsStringLiteral } from './ts-string-literal';

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue | undefined };

/**
 * Render a JSON-compatible value as a TypeScript source-text literal.
 *
 * Accepts `unknown` for ergonomics with structural types (e.g. `ColumnSpec`,
 * `ForeignKeySpec`) whose fields are all JSON-compatible but whose interfaces
 * lack the index signature TypeScript requires for `JsonObject` assignability.
 * Non-JSON values (Date, Symbol, Function, etc.) throw at runtime.
 */
export function jsonToTsSource(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return tsStringLiteral(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return tsArraySource(value.map((v: unknown) => jsonToTsSource(v)));
  }
  if (typeof value === 'object') {
    return tsObjectSource(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, jsonToTsSource(v)] as const),
    );
  }
  throw new InternalError(`jsonToTsSource: unsupported value type "${typeof value}"`);
}

/** An object literal from entries whose values are already TypeScript source, laid out as `jsonToTsSource` lays out objects. */
export function tsObjectSource(
  entries: readonly (readonly [key: string, source: string])[],
): string {
  if (entries.length === 0) return '{}';
  const items = entries.map(([key, source]) => `${renderKey(key)}: ${source}`);
  const singleLine = `{ ${items.join(', ')} }`;
  if (singleLine.length <= 80 && !singleLine.includes('\n')) return singleLine;
  return `{\n${items.map((i) => `  ${i}`).join(',\n')},\n}`;
}

/** An array literal from items that are already TypeScript source, laid out as `jsonToTsSource` lays out arrays. */
export function tsArraySource(items: readonly string[]): string {
  if (items.length === 0) return '[]';
  const singleLine = `[${items.join(', ')}]`;
  if (singleLine.length <= 80 && !singleLine.includes('\n')) return singleLine;
  return `[\n${items.map((i) => `  ${i}`).join(',\n')},\n]`;
}

function renderKey(key: string): string {
  if (key === '__proto__') return tsStringLiteral(key);
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : tsStringLiteral(key);
}
