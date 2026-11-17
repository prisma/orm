import { clipToUtf8Bytes, utf8ByteLength } from '@internal/utils/text';

/** `NAMEDATALEN - 1`: the longest identifier Postgres stores, in bytes. */
export const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

/** The name Postgres stores for an identifier it is given: the first 63 bytes, cut on a character boundary. */
export function storedIdentifier(name: string): string {
  return clipToUtf8Bytes(name, POSTGRES_IDENTIFIER_MAX_BYTES);
}

/**
 * The name Postgres gives an object it names itself, as its `makeObjectName` does: `{first}_{second}_{label}`, or `{first}_{label}` without a second name, with the longer of the two names trimmed by bytes, cut on a character boundary, until the name fits 63 bytes. A SERIAL column's sequence is `(table, column, 'seq')`; an unnamed primary key is `(table, undefined, 'pkey')`.
 */
export function postgresObjectName(
  first: string,
  second: string | undefined,
  label: string,
): string {
  const separators = second === undefined ? 1 : 2;
  const available = POSTGRES_IDENTIFIER_MAX_BYTES - utf8ByteLength(label) - separators;
  let firstBytes = utf8ByteLength(first);
  let secondBytes = second === undefined ? 0 : utf8ByteLength(second);
  while (firstBytes + secondBytes > available) {
    if (firstBytes > secondBytes) firstBytes--;
    else secondBytes--;
  }
  const head = clipToUtf8Bytes(first, firstBytes);
  return second === undefined
    ? `${head}_${label}`
    : `${head}_${clipToUtf8Bytes(second, secondBytes)}_${label}`;
}
