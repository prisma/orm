import Database from 'better-sqlite3'
import { expect, it, vi } from 'vitest'

import { PrismaBetterSqlite3Adapter } from './better-sqlite3'

it('releases the mutex when BEGIN fails so the next transaction can start', async () => {
  const client = new Database(':memory:')
  const adapter = new PrismaBetterSqlite3Adapter(client)
  const error = new Error('BEGIN failed')
  const prepare = vi.spyOn(client, 'prepare').mockImplementationOnce(() => {
    throw error
  })

  try {
    await expect(adapter.startTransaction()).rejects.toBe(error)
    expect(prepare).toHaveBeenCalledWith('BEGIN')

    const transaction = await adapter.startTransaction()
    expect(client.inTransaction).toBe(true)
    await transaction.executeRaw({ sql: 'ROLLBACK', args: [], argTypes: [] })
    await transaction.rollback()
  } finally {
    prepare.mockRestore()
    await adapter.dispose()
  }
}, 1000)
