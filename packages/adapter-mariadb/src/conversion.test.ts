import * as mariadb from 'mariadb'
import { describe, expect, it } from 'vitest'

import { mapArg, mapRow } from './conversion'

describe('mapRow', () => {
  it('maps datetime columns from object rows to ISO strings', () => {
    const row = { createdAt: '2024-01-02 03:04:05.000' }

    const result = mapRow(row, [{ type: 'DATETIME' } as unknown as mariadb.FieldInfo])

    expect(result).toEqual(['2024-01-02T03:04:05+00:00'])
  })

  it('maps bigint columns from object rows to strings', () => {
    const row = { id: 123n }

    const result = mapRow(row, [{ type: 'BIGINT' } as unknown as mariadb.FieldInfo])

    expect(result).toEqual(['123'])
  })

  it('preserves property order for mixed object rows', () => {
    const row = {
      createdAt: '2024-01-02 03:04:05.123',
      id: 5n,
      note: null,
    }

    const result = mapRow(row, [
      { type: 'DATETIME' } as unknown as mariadb.FieldInfo,
      { type: 'BIGINT' } as unknown as mariadb.FieldInfo,
      { type: 'VARCHAR' } as unknown as mariadb.FieldInfo,
    ])

    expect(result).toEqual(['2024-01-02T03:04:05.123+00:00', '5', null])
  })
})

describe('mapArg returns Date for datetime to let driver handle timezone', () => {
  it('returns the original Date object for DATETIME columns (lets driver handle timezone)', () => {
    const inputDate = new Date('2026-07-16T16:39:36.363+08:00')

    // @ts-ignore - testing with a mock argType
    const result = mapArg(inputDate, { dbType: 'DATETIME' })

    expect(result).toBe(inputDate)
  })

  it('returns the original Date object for TIMESTAMP columns', () => {
    const inputDate = new Date('2026-07-16T16:39:36.363+05:00')

    // @ts-ignore - testing with a mock argType
    const result = mapArg(inputDate, { dbType: 'TIMESTAMP' })

    expect(result).toBe(inputDate)
  })

  it('formats TIME using UTC getters with an exact expected value', () => {
    // The Date is 2027-06-15T14:30:00.000Z. formatTime uses getUTCHours/Minutes/Seconds,
    // so the result is always '14:30:00' regardless of the host timezone.
    const inputDate = new Date('2027-06-15T14:30:00.000Z')

    // @ts-ignore - testing with a mock argType
    const result = mapArg(inputDate, { dbType: 'TIME' })

    expect(result).toBe('14:30:00')
  })

  it('formats DATE using UTC getters with an exact expected value', () => {
    // The Date is 2026-07-16T12:00:00.000Z. formatDate uses getUTCFullYear/Month/Date,
    // so the result is always '2026-07-16' regardless of the host timezone.
    const inputDate = new Date('2026-07-16T12:00:00.000Z')

    // @ts-ignore - testing with a mock argType
    const result = mapArg(inputDate, { dbType: 'DATE' })

    expect(result).toBe('2026-07-16')
  })

  it('formats TIME with milliseconds when the UTC value has sub-second precision', () => {
    const inputDate = new Date('2027-06-15T14:30:00.123Z')

    // @ts-ignore - testing with a mock argType
    const result = mapArg(inputDate, { dbType: 'TIME' })

    expect(result).toBe('14:30:00.123')
  })
})
