import { ConnectionInfo, Provider } from '@prisma/driver-adapter-utils'
import { z } from 'zod'

import { ExportableLogEvent } from '../log/event'
import { ExportableSpan } from '../tracing/span'

/**
 * Schema for the query request body of the query plan executor.
 *
 * POST /query
 *
 * `plan` is not typed because `@prisma/client-engine-runtime` does not provide
 * a Zod schema and it's not feasible to maintain one here currently.
 */
export const QueryRequestBody = z.object({
  model: z.string().min(1).optional(),
  operation: z.string().min(1),
  plan: z.record(z.string(), z.unknown()),
  params: z.record(z.string(), z.unknown()),
  comments: z.record(z.string(), z.string()).optional(),
})

export type QueryRequestBody = z.infer<typeof QueryRequestBody>

/**
 * Type for the query response body of the query plan executor.
 */
export type QueryResponseBody =
  | {
      data: unknown
      logs?: ExportableLogEvent[]
      spans?: ExportableSpan[]
    }
  | {
      code?: string
      error: string
      meta?: Record<string, unknown>
      logs?: ExportableLogEvent[]
      spans?: ExportableSpan[]
    }

/**
 * Schema for the transaction start request body of the query plan executor.
 *
 * POST /transaction/start
 */
export const TransactionStartRequestBody = z.object({
  timeout: z.number().optional(),
  maxWait: z.number().optional(),
  isolationLevel: z
    .enum(['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SNAPSHOT', 'SERIALIZABLE'])
    .optional(),
  newTxId: z.string().optional(),
})

export type TransactionStartRequestBody = z.infer<typeof TransactionStartRequestBody>

/**
 * Type for the transaction start response body of the query plan executor.
 */
export type TransactionStartResponseBody =
  | {
      id: string
      logs?: ExportableLogEvent[]
      spans?: ExportableSpan[]
    }
  | {
      error: string
      logs?: ExportableLogEvent[]
      spans?: ExportableSpan[]
    }

/**
 * Type for the transaction commit and rollback response body of the query plan executor.
 */
export type TransactionEndResponseBody =
  | {
      logs?: ExportableLogEvent[]
      spans?: ExportableSpan[]
    }
  | {
      error: string
      logs?: ExportableLogEvent[]
      spans?: ExportableSpan[]
    }

/**
 * Type for the `/connection-info` response body of the query plan executor.
 */
export type ConnectionInfoResponseBody = {
  provider: Provider
  connectionInfo: ConnectionInfo
}
