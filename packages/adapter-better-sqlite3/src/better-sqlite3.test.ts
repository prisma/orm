import type { ArgType, SqlDriverAdapter } from '@prisma/driver-adapter-utils'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { PrismaBetterSqlite3Adapter, PrismaBetterSqlite3AdapterFactory } from './better-sqlite3'

function selectWithParams(adapter: SqlDriverAdapter, count: number) {
  const argType: ArgType = { scalarType: 'int', arity: 'scalar' }
  return adapter.queryRaw({
    sql: `SELECT 1 WHERE 1 IN (${Array.from({ length: count }, () => '?').join(', ')})`,
    args: Array.from({ length: count }, () => 1),
    argTypes: Array.from({ length: count }, () => argType),
  })
}

describe('getConnectionInfo', () => {
  it.each(['connect', 'connectToShadowDb'] as const)(
    '%s reports the bind parameter limit of the loaded SQLite build',
    async (method) => {
      const adapter = await new PrismaBetterSqlite3AdapterFactory({ url: ':memory:' })[method]()
      try {
        const maxBindValues = adapter.getConnectionInfo?.().maxBindValues

        // SQLite has defaulted to 32766 since 3.32.0, well above the 999 fallback.
        expect(maxBindValues).toBeGreaterThan(999)
        await expect(selectWithParams(adapter, maxBindValues!)).resolves.toMatchObject({ rows: [[1]] })
        await expect(selectWithParams(adapter, maxBindValues! + 1)).rejects.toThrow('too many SQL variables')
      } finally {
        await adapter.dispose()
      }
    },
  )

  it('leaves maxBindValues unset when the SQLite build does not report it', async () => {
    const client = new Database(':memory:')
    // Builds with SQLITE_OMIT_COMPILEOPTION_DIAGS return no compile options.
    client.pragma = () => []
    const adapter = new PrismaBetterSqlite3Adapter(client)
    try {
      expect(adapter.getConnectionInfo().maxBindValues).toBeUndefined()
    } finally {
      await adapter.dispose()
    }
  })

  it('does not report relation join support', async () => {
    const adapter = await new PrismaBetterSqlite3AdapterFactory({ url: ':memory:' }).connect()
    try {
      expect(adapter.getConnectionInfo?.().supportsRelationJoins).toBe(false)
    } finally {
      await adapter.dispose()
    }
  })
})
