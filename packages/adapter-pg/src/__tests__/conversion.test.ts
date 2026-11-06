import { ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import { describe, expect, it } from 'vitest'

import { customParsers, fieldToColumnType, mapArg } from '../conversion'

describe('mapArg', () => {
  it('converts a date with a 4-digit year (value >= 1000-01-01) to the correct date', () => {
    const date = new Date('1999-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'DATE', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('1999-12-31')
  })

  it('converts a date with a 3-digit year (0100-01-01 <= value < 1000-01-01) to the correct date', () => {
    const date = new Date('0999-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'DATE', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('0999-12-31')
  })

  it('converts a date with a 2-digit year (0000-01-01 <= value < 0100-01-01) to the correct date', () => {
    const date = new Date('0099-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'DATE', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('0099-12-31')
  })

  it('converts a date with a 4-digit year (value >= 1000-01-01) to the correct datetime', () => {
    const date = new Date('1999-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'DATETIME', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('1999-12-31 23:59:59.999')
  })

  it('converts a date with a 3-digit year (0100-01-01 <= value < 1000-01-01) to the correct datetime', () => {
    const date = new Date('0999-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'DATETIME', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('0999-12-31 23:59:59.999')
  })

  it('converts a date with a 2-digit year (0000-01-01 <= value < 0100-01-01) to the correct datetime', () => {
    const date = new Date('0099-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'DATETIME', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('0099-12-31 23:59:59.999')
  })
})

describe('fieldToColumnType', () => {
  it('maps timetz[] (OID 1270) to TimeArray', () => {
    expect(fieldToColumnType(1270)).toBe(ColumnTypeEnum.TimeArray)
  })
})

describe('customParsers', () => {
  it('parses timetz[] (OID 1270) elements and strips timezone offsets', () => {
    const parse = customParsers[1270]
    expect(parse('{12:00:00+00,13:00:00-05,08:30:00+05:30,NULL}')).toEqual(['12:00:00', '13:00:00', '08:30:00', null])
  })
})
