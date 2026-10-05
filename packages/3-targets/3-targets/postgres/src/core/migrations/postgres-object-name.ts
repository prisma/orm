const IDENTIFIER_MAX_BYTES = 63;
const utf8 = new TextEncoder();

function byteLength(value: string): number {
  return utf8.encode(value).length;
}

function clipToBytes(value: string, maxBytes: number): string {
  let kept = '';
  let bytes = 0;
  for (const character of value) {
    const size = byteLength(character);
    if (bytes + size > maxBytes) break;
    kept += character;
    bytes += size;
  }
  return kept;
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
  const available = IDENTIFIER_MAX_BYTES - byteLength(label) - separators;
  let firstBytes = byteLength(first);
  let secondBytes = second === undefined ? 0 : byteLength(second);
  while (firstBytes + secondBytes > available) {
    if (firstBytes > secondBytes) firstBytes--;
    else secondBytes--;
  }
  const head = clipToBytes(first, firstBytes);
  return second === undefined
    ? `${head}_${label}`
    : `${head}_${clipToBytes(second, secondBytes)}_${label}`;
}
