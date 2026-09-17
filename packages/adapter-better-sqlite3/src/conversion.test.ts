import { ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import { describe, expect, it } from 'vitest'

import { getColumnTypes, type Row } from './conversion'

describe('getColumnTypes', () => {
  it.each([
    ['Buffer', Buffer.from([0xde, 0xad, 0xbe, 0xef])],
    ['Uint8Array', new Uint8Array([0xde, 0xad, 0xbe, 0xef])],
    ['ArrayBuffer', new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer],
  ])('infers Bytes for a %s value in a column with no declared type', (_name, value) => {
    const row: Row = { length: 1, 0: value as Row[number] }
    expect(getColumnTypes([null], [row])).toEqual([ColumnTypeEnum.Bytes])
  })
})
