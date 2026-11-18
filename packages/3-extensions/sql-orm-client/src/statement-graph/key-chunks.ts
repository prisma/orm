import type { StorageRow } from './edge';

export interface ChunkLimits {
  /** Bound parameters per statement: every column of every key is one. */
  readonly parameters: number;
  /** Estimated bytes of key values per statement, as {@link estimatedKeyBytes} counts them. */
  readonly bytes: number;
}

const encoder = new TextEncoder();

/** Splits keys, in order, into the fewest chunks that each stay within the limits. A key that alone exceeds a limit gets a chunk of its own. */
export function chunkKeys(
  keys: readonly StorageRow[],
  limits: ChunkLimits,
): readonly (readonly StorageRow[])[] {
  const chunks: StorageRow[][] = [];
  let chunk: StorageRow[] = [];
  let parameters = 0;
  let bytes = 0;
  for (const key of keys) {
    const keyParameters = Object.keys(key).length;
    const keyBytes = estimatedKeyBytes(key);
    if (
      chunk.length > 0 &&
      (parameters + keyParameters > limits.parameters || bytes + keyBytes > limits.bytes)
    ) {
      chunks.push(chunk);
      chunk = [];
      parameters = 0;
      bytes = 0;
    }
    chunk.push(key);
    parameters += keyParameters;
    bytes += keyBytes;
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

export function estimatedKeyBytes(key: StorageRow): number {
  return Object.values(key).reduce<number>((total, value) => total + valueBytes(value), 0);
}

function valueBytes(value: unknown): number {
  if (typeof value === 'string') return 2 * encoder.encode(value).length;
  if (value instanceof Uint8Array) return 2 * value.length;
  if (typeof value === 'bigint') return value.toString().length;
  return 32;
}
