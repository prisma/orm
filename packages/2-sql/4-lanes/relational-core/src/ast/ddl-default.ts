import type { ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import type { Codec, CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { codecForRef } from '@internal/framework-components/codec';
import type { CodecRef } from './codec-types';

/** What a literal default becomes in DDL: SQL NULL, or a value for the column's codec to `encode`. */
export type LiteralDefaultReading =
  | { readonly kind: 'sql-null' }
  | { readonly kind: 'value'; readonly value: unknown };

/**
 * Reads a literal default with the column's codec, as {@link DdlColumn.codecRef} describes. A `Date` is the one authored value JSON has no notation for, so it passes through. A `null` the codec refuses is SQL NULL, because SQL NULL has no stored form of its own; a codec that reads `null` (a JSON codec) makes it the JSON value null.
 */
export function readLiteralDefault(
  codec: Codec,
  value: ColumnDefaultLiteralInputValue,
): LiteralDefaultReading {
  if (value instanceof Date) return { kind: 'value', value };
  try {
    return { kind: 'value', value: codec.decodeJson(value) };
  } catch (error) {
    if (value === null) return { kind: 'sql-null' };
    throw error;
  }
}

/** What a literal default renders as in DDL: SQL NULL, or the wire value the column's codec encoded. */
export type EncodedLiteralDefault =
  | { readonly kind: 'sql-null' }
  | { readonly kind: 'wire'; readonly wire: unknown };

/**
 * Reads a column's literal default with the column's codec, built with its type parameters, and encodes it for the DDL renderer to inline. `undefined` when no codec descriptor has the column's codec id, so the renderer inlines the value as written.
 */
export async function encodeLiteralDefault(
  codecLookup: CodecLookupWithDescriptors,
  codecRef: CodecRef,
  value: ColumnDefaultLiteralInputValue,
): Promise<EncodedLiteralDefault | undefined> {
  const codec = codecForRef(codecLookup, codecRef);
  if (codec === undefined) return undefined;
  const reading = readLiteralDefault(codec, value);
  if (reading.kind === 'sql-null') return reading;
  return { kind: 'wire', wire: await codec.encode(reading.value, {}) };
}
