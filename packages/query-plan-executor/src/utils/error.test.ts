import { describe, expect, it } from 'vitest'

import { extractErrorFromUnknown } from './error'

describe('extractErrorFromUnknown', () => {
  it('returns the same Error object', () => {
    const originalError = new Error('test error')
    const result = extractErrorFromUnknown(originalError)
    expect(result).toEqual(originalError)
  })

  it('converts string to string', () => {
    const result = extractErrorFromUnknown('test string')
    expect(result).toEqual('test string')
  })

  it('converts number to string', () => {
    const result = extractErrorFromUnknown(42)
    expect(result).toEqual('42')
  })

  it('converts boolean to string', () => {
    const result = extractErrorFromUnknown(true)
    expect(result).toEqual('true')
  })

  it('converts object to string', () => {
    const testObj = { foo: 'bar' }
    const result = extractErrorFromUnknown(testObj)
    expect(result).toEqual('[object Object]')
  })

  it('converts null to string', () => {
    const result = extractErrorFromUnknown(null)
    expect(result).toEqual('null')
  })

  it('converts undefined to string', () => {
    const result = extractErrorFromUnknown(undefined)
    expect(result).toEqual('undefined')
  })
})
