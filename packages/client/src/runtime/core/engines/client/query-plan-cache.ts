import type { BatchResponse, QueryPlanNode } from '@prisma/client-engine-runtime'

const DEFAULT_MAX_BATCH_CACHE_BYTES = 64 * 1024 * 1024

type BatchCacheEntry = {
  response: BatchResponse
  bytes: number
}

// todo: store the query plan for the individual queries in a non-compacted batch
// in the `#singleCache` so that it's possible to reuse them for compatible queries
// outside of the batch in the future and avoid compiling them individually.
export class QueryPlanCache {
  readonly #singleCache: Map<string, QueryPlanNode>
  readonly #batchCache: Map<string, BatchCacheEntry>
  readonly #maxSize: number
  readonly #maxBatchCacheBytes: number
  #batchCacheBytes = 0

  constructor(maxSize = 1000, maxBatchCacheBytes = DEFAULT_MAX_BATCH_CACHE_BYTES) {
    this.#singleCache = new Map()
    this.#batchCache = new Map()
    this.#maxSize = maxSize
    this.#maxBatchCacheBytes = maxBatchCacheBytes
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
      const firstKey = this.#singleCache.keys().next().value
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
    return entry?.response
  }

  setBatch(key: string, response: BatchResponse): void {
    const existing = this.#batchCache.get(key)
    if (existing) {
      // Update existing entry (also moves to end for LRU)
      this.#batchCacheBytes -= existing.bytes
      this.#batchCache.delete(key)
    }

    const bytes = key.length + JSON.stringify(response).length
    // An entry that alone exceeds the limit would evict everything else, so it is never cached
    if (bytes > this.#maxBatchCacheBytes) {
      return
    }

    // Evict oldest while over the entry limit or pushing total batch size over the byte limit
    while (
      this.#batchCache.size > 0 &&
      (this.#batchCache.size >= this.#maxSize ||
        this.#batchCacheBytes + bytes > this.#maxBatchCacheBytes)
    ) {
      const firstKey = this.#batchCache.keys().next().value
      if (firstKey === undefined) {
        break
      }
      const evicted = this.#batchCache.get(firstKey)
      this.#batchCache.delete(firstKey)
      if (evicted) {
        this.#batchCacheBytes -= evicted.bytes
      }
    }

    this.#batchCache.set(key, { response, bytes })
    this.#batchCacheBytes += bytes
  }

  clear(): void {
    this.#singleCache.clear()
    this.#batchCache.clear()
    this.#batchCacheBytes = 0
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

  get batchCacheBytes(): number {
    return this.#batchCacheBytes
  }
}
