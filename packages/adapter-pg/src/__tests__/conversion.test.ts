import { describe, expect, it } from 'vitest'

import { mapArg, normalize_timestamp, normalize_timestamptz } from '../conversion'

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

describe('normalize_timestamp', () => {
  it('leaves standard 4-digit years unaffected', () => {
    expect(normalize_timestamp('2026-09-02 05:00:00')).toBe('2026-09-02T05:00:00+00:00')
  })

  it('prepends + to expanded years (>9999) to satisfy ISO 8601', () => {
    expect(normalize_timestamp('202609-02-05 05:00:00')).toBe('+202609-02-05T05:00:00+00:00')
  })
})

describe('normalize_timestamptz', () => {
  it('leaves standard 4-digit years unaffected', () => {
    // Note: Postgres timestamptz wire format includes the timezone offset
    expect(normalize_timestamptz('2026-09-02 05:00:00+00')).toBe('2026-09-02T05:00:00+00:00')
  })

  it('prepends + to expanded years (>9999) to satisfy ISO 8601', () => {
    expect(normalize_timestamptz('202609-02-05 05:00:00+00')).toBe('+202609-02-05T05:00:00+00:00')
  })
})
