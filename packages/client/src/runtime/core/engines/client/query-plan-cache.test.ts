import { QueryPlanCache } from './query-plan-cache'

describe('QueryPlanCache', () => {
  describe('single cache', () => {
    it('stores and retrieves entries', () => {
      const cache = new QueryPlanCache()
      const plan = { type: 'value' as const, args: null }

      cache.setSingle('key1', plan)
      const retrieved = cache.getSingle('key1')

      expect(retrieved).toBe(plan)
    })

    it('returns undefined for missing keys', () => {
      const cache = new QueryPlanCache()

      expect(cache.getSingle('nonexistent')).toBeUndefined()
    })

    it('updates existing entries', () => {
      const cache = new QueryPlanCache()
      const plan1 = { type: 'value' as const, args: null }
      const plan2 = { type: 'value' as const, args: { test: true } }

      cache.setSingle('key', plan1)
      cache.setSingle('key', plan2)

      expect(cache.getSingle('key')).toBe(plan2)
      expect(cache.singleCacheSize).toBe(1)
    })

    it('evicts oldest entry when at capacity', () => {
      const cache = new QueryPlanCache(2)
      const plan1 = { type: 'value' as const, args: 1 }
      const plan2 = { type: 'value' as const, args: 2 }
      const plan3 = { type: 'value' as const, args: 3 }

      cache.setSingle('key1', plan1)
      cache.setSingle('key2', plan2)
      cache.setSingle('key3', plan3)

      expect(cache.getSingle('key1')).toBeUndefined()
      expect(cache.getSingle('key2')).toBeDefined()
      expect(cache.getSingle('key3')).toBeDefined()
      expect(cache.singleCacheSize).toBe(2)
    })

    it('refreshes entry on get (LRU behavior)', () => {
      const cache = new QueryPlanCache(2)
      const plan1 = { type: 'value' as const, args: 1 }
      const plan2 = { type: 'value' as const, args: 2 }
      const plan3 = { type: 'value' as const, args: 3 }

      cache.setSingle('key1', plan1)
      cache.setSingle('key2', plan2)

      // Access key1 to make it recently used
      cache.getSingle('key1')

      // Add key3, should evict key2 (oldest)
      cache.setSingle('key3', plan3)

      expect(cache.getSingle('key1')).toBeDefined()
      expect(cache.getSingle('key2')).toBeUndefined()
      expect(cache.getSingle('key3')).toBeDefined()
    })
  })

  describe('batch cache', () => {
    it('stores and retrieves batch entries', () => {
      const cache = new QueryPlanCache()
      const response = {
        type: 'multi' as const,
        plans: [
          { type: 'value' as const, args: null },
          { type: 'value' as const, args: null },
        ],
      }

      cache.setBatch('batchKey', response)
      const retrieved = cache.getBatch('batchKey')

      expect(retrieved).toBe(response)
    })

    it('returns undefined for missing batch keys', () => {
      const cache = new QueryPlanCache()

      expect(cache.getBatch('nonexistent')).toBeUndefined()
    })

    it('stores compacted batch responses', () => {
      const cache = new QueryPlanCache()
      const response = {
        type: 'compacted' as const,
        plan: { type: 'value' as const, args: null },
        arguments: [{ id: 1 }, { id: 2 }],
        nestedSelection: ['name', 'email'],
        keys: ['id'],
        expectNonEmpty: true,
      }

      cache.setBatch('compactedKey', response)
      const retrieved = cache.getBatch('compactedKey')

      expect(retrieved).toBe(response)
      expect(retrieved?.type).toBe('compacted')
    })

    it('updates existing batch entries', () => {
      const cache = new QueryPlanCache()
      const response1 = { type: 'multi' as const, plans: [] }
      const response2 = { type: 'multi' as const, plans: [{ type: 'value' as const, args: null }] }

      cache.setBatch('key', response1)
      cache.setBatch('key', response2)

      expect(cache.getBatch('key')).toBe(response2)
      expect(cache.batchCacheSize).toBe(1)
    })

    it('evicts oldest batch entry when at capacity', () => {
      const cache = new QueryPlanCache(2)
      const makeResponse = (id: number) => ({
        type: 'multi' as const,
        plans: [{ type: 'value' as const, args: id }],
      })

      cache.setBatch('key1', makeResponse(1))
      cache.setBatch('key2', makeResponse(2))
      cache.setBatch('key3', makeResponse(3))

      expect(cache.getBatch('key1')).toBeUndefined()
      expect(cache.getBatch('key2')).toBeDefined()
      expect(cache.getBatch('key3')).toBeDefined()
      expect(cache.batchCacheSize).toBe(2)
    })

    it('refreshes batch entry on get (LRU behavior)', () => {
      const cache = new QueryPlanCache(2)
      const makeResponse = (id: number) => ({
        type: 'multi' as const,
        plans: [{ type: 'value' as const, args: id }],
      })

      cache.setBatch('key1', makeResponse(1))
      cache.setBatch('key2', makeResponse(2))

      // Access key1 to make it recently used
      cache.getBatch('key1')

      // Add key3, should evict key2 (oldest)
      cache.setBatch('key3', makeResponse(3))

      expect(cache.getBatch('key1')).toBeDefined()
      expect(cache.getBatch('key2')).toBeUndefined()
      expect(cache.getBatch('key3')).toBeDefined()
    })
  })

  describe('combined behavior', () => {
    it('maintains separate caches for single and batch entries', () => {
      const cache = new QueryPlanCache()

      const plan = { type: 'value' as const, args: 'single' }
      const response = { type: 'multi' as const, plans: [{ type: 'value' as const, args: 'batch' }] }

      cache.setSingle('sharedKey', plan)
      cache.setBatch('sharedKey', response)

      expect(cache.getSingle('sharedKey')).toBe(plan)
      expect(cache.getBatch('sharedKey')).toBe(response)
    })

    it('reports combined size', () => {
      const cache = new QueryPlanCache()

      cache.setSingle('single1', { type: 'value' as const, args: null })
      cache.setSingle('single2', { type: 'value' as const, args: null })
      cache.setBatch('batch1', { type: 'multi' as const, plans: [] })

      expect(cache.singleCacheSize).toBe(2)
      expect(cache.batchCacheSize).toBe(1)
      expect(cache.size).toBe(3)
    })

    it('clears both caches', () => {
      const cache = new QueryPlanCache()

      cache.setSingle('single', { type: 'value' as const, args: null })
      cache.setBatch('batch', { type: 'multi' as const, plans: [] })

      cache.clear()

      expect(cache.getSingle('single')).toBeUndefined()
      expect(cache.getBatch('batch')).toBeUndefined()
      expect(cache.size).toBe(0)
    })
  })
})
