import { describe, expect, it } from 'vitest'

import { customParsers, mapArg } from '../conversion'

const TIMESTAMPTZ_OID = 1184 // pg ScalarColumnType.TIMESTAMPTZ
const TIMESTAMPTZ_ARRAY_OID = 1185 // pg ArrayColumnType.TIMESTAMPTZ_ARRAY

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
    expect(result).toBe('1999-12-31 23:59:59.999+00:00')
  })

  it('converts a date with a 3-digit year (0100-01-01 <= value < 1000-01-01) to the correct datetime', () => {
    const date = new Date('0999-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'DATETIME', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('0999-12-31 23:59:59.999+00:00')
  })

  it('converts a date with a 2-digit year (0000-01-01 <= value < 0100-01-01) to the correct datetime', () => {
    const date = new Date('0099-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'DATETIME', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('0099-12-31 23:59:59.999+00:00')
  })
})

describe('normalize_timestamptz', () => {
  const parse = customParsers[TIMESTAMPTZ_OID] as (s: string) => string

  it('converts a UTC-6 session offset to UTC', () => {
    // PostgreSQL returns '2025-11-24 09:26:34.887-06' in a UTC-6 session;
    // the actual instant is 15:26:34.887 UTC.  The previous implementation just
    // swapped the offset label to '+00:00' without adjusting the time, producing
    // the wrong instant.  See: https://github.com/prisma/prisma/issues/26786
    expect(parse('2025-11-24 09:26:34.887-06')).toBe('2025-11-24T15:26:34.887+00:00')
  })

  it('converts a UTC+5:30 session offset to UTC', () => {
    // '2024-01-01 20:30:00+05:30' represents 15:00:00 UTC.
    expect(parse('2024-01-01 20:30:00+05:30')).toBe('2024-01-01T15:00:00.000+00:00')
  })

  it('is a no-op for values already in UTC (bare +00 suffix)', () => {
    expect(parse('2024-06-15 12:00:00+00')).toBe('2024-06-15T12:00:00.000+00:00')
  })

  it('preserves sub-second precision when converting across midnight', () => {
    expect(parse('2024-03-10 23:59:59.123-01')).toBe('2024-03-11T00:59:59.123+00:00')
  })

  it('preserves microsecond (6-digit) precision that JavaScript Date cannot represent', () => {
    // PostgreSQL supports up to 6 fractional digits; JS Date only handles 3.
    // The extra digits must survive the UTC conversion unchanged.
    expect(parse('2025-11-24 09:26:34.887654-06')).toBe('2025-11-24T15:26:34.887654+00:00')
  })

  it('normalises LMT-era offsets with seconds component (e.g. +05:53:20)', () => {
    // Some historical timezone abbreviations include a seconds component that
    // JS Date.parse cannot handle. The seconds component should be dropped and
    // the remaining ±HH:MM offset used for the conversion.
    expect(parse('1900-01-01 10:00:00+05:53:20')).toBe('1900-01-01T04:06:40.000+00:00')
  })
})

describe('normalize_timestamptz array path', () => {
  const parseArray = customParsers[TIMESTAMPTZ_ARRAY_OID] as (s: string) => string[]

  it('converts each element of a timestamptz[] literal to UTC', () => {
    expect(parseArray('{"2025-11-24 09:26:34.887-06","2024-06-15 12:00:00+00"}')).toEqual([
      '2025-11-24T15:26:34.887+00:00',
      '2024-06-15T12:00:00.000+00:00',
    ])
  })
})
