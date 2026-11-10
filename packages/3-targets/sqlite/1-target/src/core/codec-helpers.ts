/**
 * Local `JsonValue` alias for the SQLite target. Codec implementations live in `codecs.ts` (TML-2357); this module retains only the JSON-shape alias the surrounding adapter and tests still import.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];
