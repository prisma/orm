import type { ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { materializeCodec } from '@internal/framework-components/codec';
import type { CodecRef } from './codec-types';

/** What a literal default becomes in DDL: SQL NULL, or a value for the column's codec to `encode`. */
export type LiteralDefaultReading =
  | { readonly kind: 'sql-null' }
  | { readonly kind: 'value'; readonly value: unknown };

/**
 * The codec a column's literal default is read and encoded with, built with the column's type parameters, so a parameterized codec checks the default against them.
 */
export function literalDefaultCodec(
  codecLookup: CodecLookup,
  codecRef: CodecRef,
): Codec | undefined {
  const descriptor = codecLookup.descriptorFor?.(codecRef.codecId);
  return descriptor === undefined
    ? codecLookup.get(codecRef.codecId)
    : materializeCodec(descriptor, codecRef, { name: codecRef.codecId });
}

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
