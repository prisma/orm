import { ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import { describe, expect, test } from 'vitest'

import { PrismaBetterSqlite3 } from './index'

describe('PrismaBetterSqlite3Adapter', () => {
  test('returns Bytes for a BLOB expression with no declared column type', async () => {
    const adapter = await new PrismaBetterSqlite3({ url: ':memory:' }).connect()

    try {
      const result = await adapter.queryRaw({ sql: "SELECT X'DEADBEEF' AS b", args: [], argTypes: [] })

      expect(result.columnNames).toEqual(['b'])
      expect(result.columnTypes).toEqual([ColumnTypeEnum.Bytes])
      expect(Array.from(result.rows[0][0] as Uint8Array)).toEqual([0xde, 0xad, 0xbe, 0xef])
    } finally {
      await adapter.dispose()
    }
  })
})
