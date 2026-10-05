const IDENTIFIER_MAX_BYTES = 63;
const SUFFIX = '_seq';
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
 * The name Postgres gives the sequence of a `SERIAL` column: `{table}_{column}_seq`, with the longer of the table and column names trimmed by bytes, cut on a character boundary, until the name fits 63 bytes (Postgres `makeObjectName`).
 */
export function defaultSequenceName(tableName: string, columnName: string): string {
  const available = IDENTIFIER_MAX_BYTES - byteLength('_') - byteLength(SUFFIX);
  let tableBytes = byteLength(tableName);
  let columnBytes = byteLength(columnName);
  while (tableBytes + columnBytes > available) {
    if (tableBytes > columnBytes) tableBytes--;
    else columnBytes--;
  }
  return `${clipToBytes(tableName, tableBytes)}_${clipToBytes(columnName, columnBytes)}${SUFFIX}`;
}
