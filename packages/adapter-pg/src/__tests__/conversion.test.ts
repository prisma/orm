import pg from 'pg'
import { describe, expect, it } from 'vitest'

import { customParsers, mapArg, normalize_timestamp, normalize_timestamptz } from '../conversion'

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

describe('customParsers', () => {
  const MONEY = pg.types.builtins.MONEY
  const MONEY_ARRAY = 791

  it.each([
    ['$999.50', '999.50'],
    ['$1,234.50', '1234.50'],
    ['-$120.00', '-120.00'],
    ['-$1,620.00', '-1620.00'],
    ['$0.00', '0.00'],
  ])('parses money %s as %s', (input, expected) => {
    expect(customParsers[MONEY](input)).toBe(expected)
  })

  it('parses a money array', () => {
    expect(customParsers[MONEY_ARRAY]('{"$1,234.50","-$5.00"}')).toEqual(['1234.50', '-5.00'])
  })

  it.each(['5,00 €', '€5.00', '$1.234,50', '$1234.50', '$5'])(
    'rejects money %s, which is not the default format',
    (input) => {
      expect(() => customParsers[MONEY](input)).toThrow('Unsupported money format')
    },
  )
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