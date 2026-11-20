import type { SqlCommenterQueryInfo } from '@prisma/sqlcommenter'

import { shapeQuery } from '../shape/shape'

/**
 * Encodes data to base64url (URL-safe base64 without padding)
 */
export function toBase64Url(data: string): string {
  return Buffer.from(data, 'utf-8').toString('base64url')
}

/**
 * Formats query info into the compact prismaQuery format.
 *
 * Format: [modelName].action[:base64urlEncodedPayload]
 *
 * - Raw queries: just the action (e.g., "queryRaw", "executeRaw")
 * - Single queries: Model.action:base64url(query)
 * - Compacted batches: Model.action:base64url(queries)
 */
export function formatQueryInsight(queryInfo: SqlCommenterQueryInfo): string {
  switch (queryInfo.type) {
    case 'single': {
      const { modelName, action, query } = queryInfo

      if (!modelName) {
        return action
      }

      const shapedQuery = shapeQuery(query)
      const encoded = toBase64Url(JSON.stringify(shapedQuery))

      return `${modelName}.${action}:${encoded}`
    }

    case 'compacted': {
      const { modelName, action, queries } = queryInfo

      const shapedQueries = queries.map((q) => shapeQuery(q))
      const encoded = toBase64Url(JSON.stringify(shapedQueries))

      return `${modelName}.${action}:${encoded}`
    }

    default:
      throw new Error(`invalid queryInfo.type=${(queryInfo satisfies never as SqlCommenterQueryInfo).type}`)
  }
}
