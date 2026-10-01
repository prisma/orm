import { describe, expect, it } from 'vitest'

import { customParsers, mapArg } from '../conversion'

const TIMETZ_OID = 1266

describe('TIMETZ', () => {
  const parse = customParsers[TIMETZ_OID] as (value: string) => string

  it('applies the offset when reading instead of dropping it', () => {
    expect(parse('10:30:00+05:30')).toBe('05:00:00')
    expect(parse('09:15:00-06')).toBe('15:15:00')
    expect(parse('10:30:00.123456+02')).toBe('08:30:00.123456')
    expect(parse('10:30:00+00')).toBe('10:30:00')
  })

  it('wraps across midnight', () => {
    expect(parse('01:00:00+02')).toBe('23:00:00')
    expect(parse('23:00:00-02')).toBe('01:00:00')
  })

  it('writes an explicit UTC offset so the session time zone is not applied', () => {
    const date = new Date('1970-01-01T10:30:00.500Z')
    expect(mapArg(date, { dbType: 'TIMETZ', scalarType: 'datetime', arity: 'scalar' })).toBe('10:30:00.500+00')
    expect(mapArg(date, { dbType: 'TIME', scalarType: 'datetime', arity: 'scalar' })).toBe('10:30:00.500')
  })
})
