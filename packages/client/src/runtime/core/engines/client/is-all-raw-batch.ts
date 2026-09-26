/**
 * Whether every query in a batch is raw (no `modelName`).
 *
 * Mixed batches such as `$executeRaw` followed by a model query must return
 * false so the model query can still be parameterized and plan-cached.
 */
export function isAllRawBatch(queries: Array<{ modelName?: string }>): boolean {
  return queries.every((query) => query.modelName === undefined)
}
