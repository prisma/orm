import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'

import { formatQueryInsight } from './format/format'

/**
 * Creates a SQL commenter plugin that adds Prisma query shape information
 * to SQL queries as `prismaQuery` comments.
 *
 * The query shapes are parameterized to remove user data, making them safe
 * for logging and observability while still providing useful structural
 * information about the queries being executed.
 *
 * @example
 * ```ts
 * import { prismaQueryInsights } from '@prisma/sqlcommenter-query-insights'
 *
 * const prisma = new PrismaClient({
 *   adapter: myAdapter,
 *   comments: [prismaQueryInsights()],
 * })
 * ```
 *
 * Output examples:
 * - Raw query: `/*prismaQuery='queryRaw'* /`
 * - Single query: `/*prismaQuery='User.findMany:eyJzZWxlY3Rpb24iOnsiJHNjYWxhcnMiOnRydWV9fX0'* /`
 * - Batched queries: `/*prismaQuery='User.findUnique:W3siYXJndW1lbnRzIjp7IndoZXJlIjp7ImlkIjp7IiR0eXBlIjoiUGFyYW0ifX19fV0'* /`
 */
export function prismaQueryInsights(): SqlCommenterPlugin {
  return (context) => {
    const insight = formatQueryInsight(context.query)
    return { prismaQuery: insight }
  }
}
