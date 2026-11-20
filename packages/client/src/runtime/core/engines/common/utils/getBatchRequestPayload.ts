import type { JsonBatchQuery, JsonQuery } from '@prisma/json-protocol'

import { TransactionOptions } from '../Engine'

export function getBatchRequestPayload(batch: JsonQuery[], transaction?: TransactionOptions<unknown>): JsonBatchQuery {
  return {
    batch,
    transaction: transaction?.kind === 'batch' ? { isolationLevel: transaction.options.isolationLevel } : undefined,
  }
}
