import { ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import { describe, expect, it } from 'vitest'

import { PrismaBetterSqlite3AdapterFactory } from './better-sqlite3'

describe('queryRaw', () => {
  it('returns Bytes for a BLOB expression with no declared column type', async () => {
    const adapter = await new PrismaBetterSqlite3AdapterFactory({ url: ':memory:' }).connect()
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
