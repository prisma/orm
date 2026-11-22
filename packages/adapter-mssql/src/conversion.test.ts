import sql from 'mssql'
import { describe, expect, test } from 'vitest'

import { isFloatArg, mapRow } from './conversion'

describe('isFloatArg', () => {
  test.each(['FLOAT', 'REAL'])('binds numbers for %s columns as FLOAT', (dbType) => {
    expect(isFloatArg(1e20, { scalarType: 'decimal', dbType, arity: 'scalar' })).toBe(true)
  })

  test('lets mssql infer numbers for other columns', () => {
    expect(isFloatArg(2 ** 40, { scalarType: 'bigint', dbType: 'BIGINT', arity: 'scalar' })).toBe(false)
  })

  test('lets mssql infer non-numbers for FLOAT columns', () => {
    expect(isFloatArg('1e20', { scalarType: 'decimal', dbType: 'FLOAT', arity: 'scalar' })).toBe(false)
  })
})

describe('conversion', () => {
  test.each([1.1, 1.3534578, 13413.466])('returns the number %d prior to truncation - no f32 precision loss', (num) => {
    const truncated = new Float32Array([num])[0]
    expect(num).not.toEqual(truncated)
    expect(mapRow([truncated], [{ type: sql.Real, name: '', nullable: false, primary: false }])).toEqual([num])
  })

  test.each([13413.465845, 234236.243572347, 0.345783258435])('returns the number %d - f32 precision loss', (num) => {
    const truncated = new Float32Array([num])[0]
    expect(num).not.toEqual(truncated)
    expect(mapRow([num], [{ type: sql.Real, name: '', nullable: false, primary: false }])).toEqual([num])
  })
})
