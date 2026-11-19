import { ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import * as mariadb from 'mariadb'
import { describe, expect, it } from 'vitest'

import { mapColumnType, mapRow } from './conversion'

const SET_FLAG = 1 << 11

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

  // Servers send SET columns as STRING with the SET flag, and the driver
  // decodes them into arrays of strings.
  const setField = { type: 'STRING', flags: SET_FLAG } as unknown as mariadb.FieldInfo

  it('joins SET array values with a comma', () => {
    const row = { type: ['car', 'truck', 'van'] }

    const result = mapRow(row, [setField])

    expect(result).toEqual(['car,truck,van'])
  })

  it('joins SET array values for the dedicated SET wire type', () => {
    const row = { type: ['car', 'truck'] }

    const result = mapRow(row, [{ type: 'SET', flags: 0 } as unknown as mariadb.FieldInfo])

    expect(result).toEqual(['car,truck'])
  })

  it('maps empty SET array values to an empty string', () => {
    const row = { type: [] }

    const result = mapRow(row, [setField])

    expect(result).toEqual([''])
  })

  it('maps null SET values to null', () => {
    const row = { type: null }

    const result = mapRow(row, [setField])

    expect(result).toEqual([null])
  })

  it('does not join array values of columns without the SET flag', () => {
    const row = { data: ['not', 'a', 'set'] }

    const result = mapRow(row, [{ type: 'STRING', flags: 0 } as unknown as mariadb.FieldInfo])

    expect(result).toEqual([['not', 'a', 'set']])
  })
})

describe('mapColumnType', () => {
  it('maps SET columns sent as STRING with the SET flag to text', () => {
    const field = {
      type: 'STRING',
      flags: SET_FLAG,
      collation: { index: 224 },
    } as unknown as mariadb.FieldInfo

    expect(mapColumnType(field)).toEqual(ColumnTypeEnum.Text)
  })

  it('maps columns with the dedicated SET wire type to text', () => {
    const field = { type: 'SET', flags: 0 } as unknown as mariadb.FieldInfo

    expect(mapColumnType(field)).toEqual(ColumnTypeEnum.Text)
  })
})
