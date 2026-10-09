import * as mariadb from 'mariadb'
import { describe, expect, it } from 'vitest'

import { mapArg, mapRow } from './conversion'

describe('mapRow', () => {
  it('maps datetime columns from object rows to ISO strings', () => {
    const row = { createdAt: '2024-01-02 03:04:05.000' }

    const result = mapRow(row, [{ type: 'DATETIME' } as unknown as mariadb.FieldInfo])

    expect(result).toEqual(['2024-01-02T03:04:05+00:00'])
  })

  it('maps timestamp columns to UTC ISO strings', () => {
    // The factory forces timezone: '+00:00', so TIMESTAMP strings from the driver
    // are always in UTC.  mapRow must treat them as UTC (not local time).
    const row = { happenedAt: '2025-11-24 15:26:34.887' }

    const result = mapRow(row, [{ type: 'TIMESTAMP' } as unknown as mariadb.FieldInfo])

    expect(result).toEqual(['2025-11-24T15:26:34.887+00:00'])
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

describe('mapArg datetime formatting', () => {
  it('formats a UTC Date as a plain datetime string without offset suffix', () => {
    const date = new Date('2025-11-24T15:26:34.887Z')
    const result = mapArg(date, { dbType: 'DATETIME', scalarType: 'datetime', arity: 'scalar' })
    // MariaDB rejects offset syntax in datetime literals; UTC is enforced
    // via timezone:'UTC' on the connection config instead.
    expect(result).toBe('2025-11-24 15:26:34.887')
  })

  it('formats a UTC Date without milliseconds', () => {
    const date = new Date('2024-01-01T00:00:00.000Z')
    const result = mapArg(date, { dbType: 'DATETIME', scalarType: 'datetime', arity: 'scalar' })
    expect(result).toBe('2024-01-01 00:00:00')
  })
})
