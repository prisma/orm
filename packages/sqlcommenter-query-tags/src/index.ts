import { AsyncLocalStorage } from 'node:async_hooks'

import type { SqlCommenterPlugin, SqlCommenterTags } from '@prisma/sqlcommenter'

const asyncLocalStorage = new AsyncLocalStorage<SqlCommenterTags>()

/**
 * Creates a SQL commenter plugin that retrieves query tags from AsyncLocalStorage.
 * Use this plugin with `withQueryTags()` to add ad-hoc tags to your queries.
 *
 * @example
 * ```ts
 * import { queryTags, withQueryTags } from '@prisma/sqlcommenter-query-tags'
 *
 * const prisma = new PrismaClient({
 *   adapter: myAdapter,
 *   comments: [queryTags()],
 * })
 *
 * // Later, wrap your queries to add tags:
 * const posts = await withQueryTags(
 *   { route: '/api/posts', user: 'user-123' },
 *   () => prisma.post.findMany()
 * )
 * ```
 */
export function queryTags(): SqlCommenterPlugin {
  return () => asyncLocalStorage.getStore() ?? {}
}

/**
 * Executes a function with the given query tags added to all SQL queries within its scope.
 * Tags are stored in AsyncLocalStorage and retrieved by the `queryTags()` plugin.
 *
 * @param tags - Key-value pairs to add as SQL comments
 * @param scope - An async function to execute within the tagged scope
 * @returns The result of the scope function
 *
 * @example
 * ```ts
 * const result = await withQueryTags(
 *   { route: '/api/users', requestId: 'abc-123' },
 *   async () => {
 *     // All queries here will have the tags attached
 *     const users = await prisma.user.findMany()
 *     const posts = await prisma.post.findMany()
 *     return { users, posts }
 *   }
 * )
 * ```
 */
export function withQueryTags<T>(tags: SqlCommenterTags, scope: () => PromiseLike<T>): Promise<T> {
  return asyncLocalStorage.run(tags, async () => await scope())
}

/**
 * Executes a function with merged query tags added to all SQL queries within its scope.
 * Unlike `withQueryTags`, this function merges the provided tags with any existing tags
 * from an outer scope, with the new tags taking precedence for keys that exist in both.
 *
 * @param tags - Key-value pairs to merge with existing tags
 * @param scope - An async function to execute within the tagged scope
 * @returns The result of the scope function
 *
 * @example
 * ```ts
 * // Outer scope sets base tags
 * await withQueryTags({ requestId: 'req-123', source: 'api' }, async () => {
 *   // Inner scope adds/overrides tags
 *   await withMergedQueryTags({ userId: 'user-456', source: 'handler' }, async () => {
 *     // Queries here will have: requestId='req-123', userId='user-456', source='handler'
 *     await prisma.user.findMany()
 *   })
 * })
 * ```
 */
export function withMergedQueryTags<T>(tags: SqlCommenterTags, scope: () => PromiseLike<T>): Promise<T> {
  const existingTags = asyncLocalStorage.getStore() ?? {}
  const mergedTags: SqlCommenterTags = { ...existingTags, ...tags }
  return asyncLocalStorage.run(mergedTags, async () => await scope())
}
