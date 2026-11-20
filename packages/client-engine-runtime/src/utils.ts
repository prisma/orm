import { Decimal } from '@prisma/client-runtime-utils'

export type DeepReadonly<T> = T extends undefined | null | boolean | string | number | symbol | Function | Date
  ? T
  : T extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : unknown extends T
      ? unknown
      : { readonly [K in keyof T]: DeepReadonly<T[K]> }

export type DeepUnreadonly<T> = T extends undefined | null | boolean | string | number | symbol | Function | Date
  ? T
  : T extends ReadonlyArray<infer U>
    ? Array<DeepUnreadonly<U>>
    : unknown extends T
      ? unknown
      : { -readonly [K in keyof T]: DeepUnreadonly<T[K]> }

// Copied over to avoid the heavy dependency on `@prisma/internals` with its
// transitive dependencies that are not needed for other query plan executor
// implementations outside of Prisma Client (e.g. test executor for query
// engine tests and query plan executor for Accelerate) that also depend on
// `@prisma/client-engine-runtime`.
/**
 * Cross-realm safe check for Uint8Array. `instanceof Uint8Array` fails when the value
 * was created in a different realm (e.g. jsdom, iframes, vm contexts).
 */
export function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
}

/**
 * Cross-realm safe check for Date. `instanceof Date` fails when the value
 * was created in a different realm (e.g. jsdom, iframes, vm contexts).
 */
export function isDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]'
}

export function assertNever(_: never, message: string): never {
  throw new Error(message)
}

/**
 * Checks if two objects are deeply equal, recursively checking all properties for strict equality.
 */
export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => isDeepStrictEqual(a[key], b[key])))
  )
}

/**
 * Checks if two objects representing the names and values of key columns match. A match is
 * defined by one of the sets of keys being a subset of the other. This function also
 * converts arguments to the types used by driver adapters if necessary.
 */
export function doKeysMatch(lhs: {}, rhs: {}): boolean {
  const lhsKeys = Object.keys(lhs)
  const rhsKeys = Object.keys(rhs)
  const smallerKeyList = lhsKeys.length < rhsKeys.length ? lhsKeys : rhsKeys

  return smallerKeyList.every((key) => {
    if (typeof lhs[key] === typeof rhs[key] && typeof lhs[key] !== 'object') {
      // fast path for primitive types
      return lhs[key] === rhs[key]
    }

    if (Decimal.isDecimal(lhs[key]) || Decimal.isDecimal(rhs[key])) {
      const lhsDecimal = asDecimal(lhs[key])
      const rhsDecimal = asDecimal(rhs[key])
      return lhsDecimal && rhsDecimal && lhsDecimal.equals(rhsDecimal)
    } else if (isUint8Array(lhs[key]) || isUint8Array(rhs[key])) {
      const lhsBuffer = asBuffer(lhs[key])
      const rhsBuffer = asBuffer(rhs[key])
      return lhsBuffer && rhsBuffer && lhsBuffer.equals(rhsBuffer)
    } else if (isDate(lhs[key]) || isDate(rhs[key])) {
      return asDate(lhs[key])?.getTime() === asDate(rhs[key])?.getTime()
    } else if (typeof lhs[key] === 'bigint' || typeof rhs[key] === 'bigint') {
      return asBigInt(lhs[key]) === asBigInt(rhs[key])
    } else if (typeof lhs[key] === 'number' || typeof rhs[key] === 'number') {
      return asNumber(lhs[key]) === asNumber(rhs[key])
    }

    return isDeepStrictEqual(lhs[key], rhs[key])
  })
}

function asDecimal(value: unknown): Decimal | undefined {
  if (Decimal.isDecimal(value)) {
    return value
  } else if (typeof value === 'number' || typeof value === 'string') {
    return new Decimal(value)
  } else {
    return
  }
}

function asBuffer(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) {
    return value
  } else if (isUint8Array(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  } else if (typeof value === 'string') {
    return Buffer.from(value, 'base64')
  } else {
    return
  }
}

function asDate(value: unknown): Date | undefined {
  if (isDate(value)) {
    return value
  } else if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value)
  } else {
    return
  }
}

function asBigInt(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') {
    return value
  } else if (typeof value === 'number' || typeof value === 'string') {
    return BigInt(value)
  } else {
    return
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value
  } else if (typeof value === 'string') {
    return Number(value)
  } else {
    return
  }
}

/**
 * `JSON.stringify` wrapper with custom replacer function that handles nested
 * BigInt and Uint8Array values.
 */
export function safeJsonStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, val) => {
    if (typeof val === 'bigint') {
      return val.toString()
    } else if (ArrayBuffer.isView(val)) {
      return Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString('base64')
    }
    return val
  })
}

// Stays well below the engine's maximum argument count (~65K in V8) so that
// `push(...)` remains safe even when the call stack is already deep, while a
// single spread stays the fast path for typical sizes.
// See https://github.com/prisma/prisma/issues/29746.
const MAX_PUSH_SPREAD_ARGS = 8192

/**
 * Appends all elements of `source` to `target` without spreading the whole
 * array as call arguments, which overflows the stack for large arrays.
 */
export function appendToArray<T>(target: T[], source: readonly T[]): void {
  if (source.length <= MAX_PUSH_SPREAD_ARGS) {
    target.push(...source)
    return
  }
  for (let i = 0; i < source.length; i += MAX_PUSH_SPREAD_ARGS) {
    target.push(...source.slice(i, i + MAX_PUSH_SPREAD_ARGS))
  }
}
