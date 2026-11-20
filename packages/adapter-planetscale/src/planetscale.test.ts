import * as planetScale from '@planetscale/database'
import { describe, expect, test, vi } from 'vitest'

import { PrismaPlanetScaleAdapter, PrismaPlanetScaleAdapterFactory } from './planetscale'

describe('behavior of PrismaPlanetScaleAdapterFactory', () => {
  test('uses the provided adapter instance', async () => {
    const inst = new planetScale.Client({})
    const factory = new PrismaPlanetScaleAdapterFactory(inst)
    const spy = vi.spyOn(inst, 'execute')

    const adapter = await factory.connect()
    await adapter.queryRaw({ sql: 'SELECT 1', argTypes: [], args: [] }).catch(() => {})
    expect(spy).toHaveBeenCalledWith('SELECT 1', [], expect.anything())
  })
})

describe('startTransaction / commit / rollback', () => {
  function createAdapterWithMockConnection(mockTransaction: (fn: (tx: any) => Promise<void>) => Promise<void>) {
    const client = new planetScale.Client({})
    const mockConnection = {
      execute: vi.fn(),
      transaction: mockTransaction,
    }
    vi.spyOn(client, 'connection').mockReturnValue(mockConnection as any)
    return new PrismaPlanetScaleAdapter(client)
  }

  // The real @planetscale/database driver defers the callback invocation by at least
  // one microtask (via internal async operations like BEGIN). We simulate this with
  // `await Promise.resolve()` to avoid the `txResultPromise` temporal dead zone.
  function deferredTransaction(afterCallback?: () => never | void) {
    return vi.fn((fn: (tx: any) => Promise<void>) => {
      const mockTx = { execute: vi.fn() }
      return Promise.resolve()
        .then(() => fn(mockTx))
        .then(() => {
          afterCallback?.()
        })
    })
  }

  test('commit succeeds when conn.transaction() resolves', async () => {
    const adapter = createAdapterWithMockConnection(deferredTransaction())
    const tx = await adapter.startTransaction()
    await tx.commit()
  })

  test('commit throws when conn.transaction() rejects after COMMIT failure', async () => {
    const commitError = new Error('target: .0.primary: vttablet: deadline exceeded (errno 1317) (sqlstate 70100)')

    const adapter = createAdapterWithMockConnection(
      deferredTransaction(() => {
        throw commitError
      }),
    )
    const tx = await adapter.startTransaction()

    // commit() should propagate the COMMIT error instead of silently swallowing it
    await expect(tx.commit()).rejects.toThrow(commitError)
  })

  test('rollback does not throw (RollbackError is swallowed)', async () => {
    const adapter = createAdapterWithMockConnection(deferredTransaction())
    const tx = await adapter.startTransaction()

    // rollback should not throw — RollbackError is intentionally swallowed
    await tx.rollback()
  })
})
