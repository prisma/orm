import { ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import { describe, expect, it } from 'vitest'

import { getColumnTypes, mapRow, type Row } from './conversion'

describe('getColumnTypes', () => {
  it.each([
    ['Buffer', Buffer.from([0xde, 0xad, 0xbe, 0xef])],
    ['Uint8Array', new Uint8Array([0xde, 0xad, 0xbe, 0xef])],
    ['ArrayBuffer', new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer],
  ])('infers Bytes for a %s value in a column with no declared type', (_name, value) => {
    const row = { length: 1, 0: value } as unknown as Row

    const columnTypes = getColumnTypes([null], [row])

    expect(columnTypes).toEqual([ColumnTypeEnum.Bytes])
  })

  it('still rejects other objects in a column with no declared type', () => {
    const row = { length: 1, 0: { not: 'a blob' } } as unknown as Row

    expect(() => getColumnTypes([null], [row])).toThrow('unexpected value of type object')
  })
})

describe('mapRow', () => {
  it('passes a Buffer through as a Uint8Array with the same bytes', () => {
    const row = { length: 1, 0: Buffer.from([0xde, 0xad, 0xbe, 0xef]) } as Row

    const [value] = mapRow(row, [ColumnTypeEnum.Bytes])

    expect(value).toBeInstanceOf(Uint8Array)
    expect(Array.from(value as Uint8Array)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })
})
