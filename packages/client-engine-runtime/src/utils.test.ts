import vm from 'node:vm'

import { describe, expect, test } from 'vitest'

import { doKeysMatch, isDate, isUint8Array } from './utils'

// A separate V8 realm whose `Uint8Array`/`Date` globals are distinct
// constructors, so values created here fail `instanceof` against this realm's
// globals — the exact situation jsdom, iframes, and `vm` contexts produce.
const foreignRealm = vm.createContext({})

function foreignUint8Array(bytes: number[]): Uint8Array {
  return vm.runInContext(`new Uint8Array([${bytes.join(',')}])`, foreignRealm)
}

function foreignDate(time: number): Date {
  return vm.runInContext(`new Date(${time})`, foreignRealm)
}

describe('isUint8Array', () => {
  test('detects a same-realm Uint8Array', () => {
    expect(isUint8Array(new Uint8Array([1, 2, 3]))).toBe(true)
  })

  test('detects a Buffer (Uint8Array subclass)', () => {
    expect(isUint8Array(Buffer.from([1, 2, 3]))).toBe(true)
  })

  test('detects a cross-realm Uint8Array where instanceof fails', () => {
    const value = foreignUint8Array([1, 2, 3])
    expect(value instanceof Uint8Array).toBe(false)
    expect(isUint8Array(value)).toBe(true)
  })

  test('rejects other typed arrays and non-array values', () => {
    expect(isUint8Array(new Int8Array([1]))).toBe(false)
    expect(isUint8Array(new Uint16Array([1]))).toBe(false)
    expect(isUint8Array([1, 2, 3])).toBe(false)
    expect(isUint8Array('bytes')).toBe(false)
    expect(isUint8Array(null)).toBe(false)
    expect(isUint8Array(undefined)).toBe(false)
  })
})

describe('isDate', () => {
  test('detects a same-realm Date', () => {
    expect(isDate(new Date())).toBe(true)
  })

  test('detects a cross-realm Date where instanceof fails', () => {
    const value = foreignDate(0)
    expect(value instanceof Date).toBe(false)
    expect(isDate(value)).toBe(true)
  })

  test('rejects non-Date values', () => {
    expect(isDate(0)).toBe(false)
    expect(isDate('1970-01-01')).toBe(false)
    expect(isDate({})).toBe(false)
    expect(isDate(null)).toBe(false)
  })
})

describe('doKeysMatch with cross-realm values', () => {
  test('matches equal cross-realm Uint8Array values', () => {
    expect(doKeysMatch({ bytes: foreignUint8Array([1, 2, 3]) }, { bytes: new Uint8Array([1, 2, 3]) })).toBe(true)
    expect(doKeysMatch({ bytes: foreignUint8Array([1, 2, 3]) }, { bytes: new Uint8Array([4, 5, 6]) })).toBe(false)
  })

  test('matches equal cross-realm Date values', () => {
    expect(doKeysMatch({ at: foreignDate(1000) }, { at: new Date(1000) })).toBe(true)
    expect(doKeysMatch({ at: foreignDate(1000) }, { at: new Date(2000) })).toBe(false)
  })
})
