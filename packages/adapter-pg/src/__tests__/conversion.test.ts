import pg from 'pg'
import { describe, expect, it } from 'vitest'

import { customParsers, mapArg } from '../conversion'

const { types } = pg
const { builtins: ScalarColumnType } = types

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
  it('converts a TIMESTAMPTZ date to a datetime string with UTC offset', () => {
    const date = new Date('2026-06-26T18:20:07.000Z')
    const result = mapArg(date, { dbType: 'TIMESTAMPTZ', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('2026-06-26 18:20:07+00:00')
  })

  it('converts a TIMESTAMPTZ date with milliseconds to a datetime string with UTC offset', () => {
    const date = new Date('1999-12-31T23:59:59.999Z')
    const result = mapArg(date, { dbType: 'TIMESTAMPTZ', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('1999-12-31 23:59:59.999+00:00')
  })

  it('converts a TIMESTAMPTZ string input with Z suffix to a datetime string with UTC offset', () => {
    const result = mapArg('2026-06-26T18:20:07.000Z', {
      dbType: 'TIMESTAMPTZ',
      scalarType: 'datetime',
      arity: 'scalar',
    })
    expect(result).toBe('2026-06-26 18:20:07+00:00')
  })
  it('converts a TIMESTAMPTZ string input with +00:00 offset to a datetime string with UTC offset', () => {
    const result = mapArg('2026-06-26T18:20:07.000+00:00', {
      dbType: 'TIMESTAMPTZ',
      scalarType: 'datetime',
      arity: 'scalar',
    })
    expect(result).toBe('2026-06-26 18:20:07+00:00')
  })

  it('converts a TIMESTAMPTZ string input with a non-UTC offset to the shifted UTC datetime string', () => {
    const result = mapArg('2026-06-26T18:20:07.000+05:30', {
      dbType: 'TIMESTAMPTZ',
      scalarType: 'datetime',
      arity: 'scalar',
    })
    expect(result).toBe('2026-06-26 12:50:07+00:00')
  })
})

describe('normalize_timestamptz (read path)', () => {
  const parse = customParsers[ScalarColumnType.TIMESTAMPTZ]

  it('preserves positive offset from PostgreSQL', () => {
    expect(parse('2026-06-30 10:47:04+05:30')).toBe('2026-06-30T10:47:04+05:30')
  })

  it('preserves negative offset from PostgreSQL', () => {
    expect(parse('2026-06-30 10:47:04-06')).toBe('2026-06-30T10:47:04-06')
  })

  it('preserves UTC offset from PostgreSQL', () => {
    expect(parse('2026-06-30 16:47:04+00')).toBe('2026-06-30T16:47:04+00')
  })

  it('preserves fractional seconds with offset', () => {
    expect(parse('2024-01-15 08:30:00.123456-08:00')).toBe('2024-01-15T08:30:00.123456-08:00')
  })

  it('preserves the instant (shift, not relabel) when read from a non-UTC PostgreSQL session', () => {
    // Regression for prisma/prisma#26786: reading a TIMESTAMPTZ from a session
    // whose timezone is not UTC (here Asia/Tokyo, +09:00) must keep the original
    // offset so that the instant is preserved. Relabeling the offset to +00:00
    // instead would shift the instant by the offset amount.
    const normalized = parse('2025-01-01 09:00:00+09:00')
    expect(normalized).toBe('2025-01-01T09:00:00+09:00')
    expect(new Date(normalized).toISOString()).toBe('2025-01-01T00:00:00.000Z')

    // The previous relabeling behavior would have produced the wrong instant.
    expect(new Date('2025-01-01T09:00:00+00:00').toISOString()).not.toBe('2025-01-01T00:00:00.000Z')
  })
})
