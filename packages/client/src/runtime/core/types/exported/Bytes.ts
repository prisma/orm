/**
 * Equivalent to `Uint8Array` before TypeScript 5.7, and `Uint8Array<ArrayBuffer>` in TypeScript 5.7 and beyond.
 */
export type Bytes = ReturnType<Uint8Array['slice']>
