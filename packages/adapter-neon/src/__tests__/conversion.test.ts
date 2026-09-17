import { types } from '@neondatabase/serverless'
import { describe, expect, it } from 'vitest'

import { customParsers, mapArg } from '../conversion'

const { builtins: ScalarColumnType } = types

describe('mapArg TIMESTAMPTZ write path', () => {
  it('converts a TIMESTAMPTZ date to a datetime string with UTC offset', () => {
    const date = new Date('2026-06-26T18:20:07.000Z')
    const result = mapArg(date, { dbType: 'TIMESTAMPTZ', scalarType: 'datetime', arity: 'scalar' })
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

  it('preserves the offset so the instant is not shifted', () => {
    expect(parse('2026-06-30 10:47:04+05:30')).toBe('2026-06-30T10:47:04+05:30')
  })

  it('preserves the instant (shift, not relabel) when read from a non-UTC PostgreSQL session', () => {
    // Regression for prisma/prisma#26786.
    const normalized = parse('2025-01-01 09:00:00+09:00')
    expect(normalized).toBe('2025-01-01T09:00:00+09:00')
    expect(new Date(normalized).toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })
})
