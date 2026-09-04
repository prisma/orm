import type { BatchResponse, QueryPlanNode } from '@prisma/client-engine-runtime'

// todo: store the query plan for the individual queries in a non-compacted batch
// in the `#singleCache` so that it's possible to reuse them for compatible queries
// outside of the batch in the future and avoid compiling them individually.
export class QueryPlanCache {
  readonly #singleCache: Map<string, QueryPlanNode>
  readonly #batchCache: Map<string, BatchResponse>
  readonly #maxSize: number
  #batchCacheTotalQueries: number

  constructor(maxSize = 1000) {
    this.#singleCache = new Map()
    this.#batchCache = new Map()
    this.#maxSize = maxSize
    this.#batchCacheTotalQueries = 0
  }

  getSingle(key: string): QueryPlanNode | undefined {
    const entry = this.#singleCache.get(key)
    if (entry) {
      // Move to end for LRU behavior
      this.#singleCache.delete(key)
      this.#singleCache.set(key, entry)
    }
    return entry
  }

  setSingle(key: string, plan: QueryPlanNode): void {
    if (this.#singleCache.has(key)) {
      // Update existing entry (also moves to end for LRU)
      this.#singleCache.delete(key)
      this.#singleCache.set(key, plan)
      return
    }

    // Evict oldest if at capacity
    if (this.#singleCache.size >= this.#maxSize) {
      const firstKey = this.#singleCache.keys().next().value as string | undefined
      if (firstKey !== undefined) {
        this.#singleCache.delete(firstKey)
      }
    }

    this.#singleCache.set(key, plan)
  }

  getBatch(key: string): BatchResponse | undefined {
    const entry = this.#batchCache.get(key)
    if (entry) {
      // Move to end for LRU behavior
      this.#batchCache.delete(key)
      this.#batchCache.set(key, entry)
    }
    return entry
  }

  setBatch(key: string, response: BatchResponse): void {
    const queryCount = this.#getBatchQueryCount(response)

    // Do not cache a single batch if it exceeds the maximum size by itself
    if (queryCount > this.#maxSize) {
      return
    }

    if (this.#batchCache.has(key)) {
      const oldResponse = this.#batchCache.get(key)!
      this.#batchCacheTotalQueries -= this.#getBatchQueryCount(oldResponse)
      this.#batchCache.delete(key)
    }

    this.#batchCache.set(key, response)
    this.#batchCacheTotalQueries += queryCount

    // Evict oldest if at capacity
    while (this.#batchCacheTotalQueries > this.#maxSize) {
      const firstKey = this.#batchCache.keys().next().value as string | undefined
      if (firstKey !== undefined) {
        const evicted = this.#batchCache.get(firstKey)!
        this.#batchCacheTotalQueries -= this.#getBatchQueryCount(evicted)
        this.#batchCache.delete(firstKey)
      } else {
        break
      }
    }
  }

  #getBatchQueryCount(response: BatchResponse): number {
    if (response.type === 'multi') {
      // Floor at 1 so empty multi batches still contribute to eviction
      return Math.max(response.plans.length, 1)
    }
    // compacted batches execute one query per argument set
    return response.arguments.length
  }

  clear(): void {
    this.#singleCache.clear()
    this.#batchCache.clear()
    this.#batchCacheTotalQueries = 0
  }

  get size(): number {
    return this.#singleCache.size + this.#batchCache.size
  }

  get singleCacheSize(): number {
    return this.#singleCache.size
  }

  get batchCacheSize(): number {
    return this.#batchCache.size
  }
}
