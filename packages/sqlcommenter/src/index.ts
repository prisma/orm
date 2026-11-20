import type { JsonQueryAction } from '@prisma/json-protocol'

/**
 * Information about a single Prisma query.
 */
export interface SqlCommenterSingleQueryInfo {
  /**
   * The model name (e.g., "User", "Post"). Undefined for raw queries.
   */
  readonly modelName?: string

  /**
   * The Prisma operation (e.g., "findMany", "createOne", "queryRaw").
   */
  readonly action: SqlCommenterQueryAction

  /**
   * The full query object (selection, arguments, etc.).
   * Specifics of the query representation are not part of the public API yet.
   */
  readonly query: unknown
}

/**
 * Information about a compacted batch query (e.g. multiple independent
 * `findUnique` queries automatically merged into a single `SELECT` SQL
 * statement).
 */
export interface SqlCommenterCompactedQueryInfo {
  /**
   * The model name (e.g., "User", "Post").
   */
  readonly modelName: string

  /**
   * The Prisma operation (e.g., "findUnique").
   */
  readonly action: SqlCommenterQueryAction

  /**
   * The full query objects (selections, arguments, etc.).
   * Specifics of the query representation are not part of the public API yet.
   */
  readonly queries: ReadonlyArray<unknown>
}

/**
 * Prisma query type corresponding to this SQL query.
 */
export type SqlCommenterQueryAction = JsonQueryAction

/**
 * Information about the query or queries being executed.
 *
 * - `single`: A single query is being executed
 * - `compacted`: Multiple queries have been compacted into a single SQL statement
 */
export type SqlCommenterQueryInfo =
  | ({ readonly type: 'single' } & SqlCommenterSingleQueryInfo)
  | ({ readonly type: 'compacted' } & SqlCommenterCompactedQueryInfo)

/**
 * Context provided to SQL commenter plugins.
 */
export interface SqlCommenterContext {
  /**
   * Information about the Prisma query being executed.
   */
  readonly query: SqlCommenterQueryInfo

  /**
   * Raw SQL query generated from this Prisma query.
   *
   * It is always available when `PrismaClient` connects to the database and
   * renders SQL queries directly.
   *
   * When using Prisma Accelerate, SQL rendering happens on Accelerate side and the raw
   * SQL strings are not yet available when SQL commenter plugins are executed.
   */
  readonly sql?: string
}

/**
 * Key-value pairs to add as SQL comments.
 * Keys with undefined values will be omitted from the final comment.
 */
export type SqlCommenterTags = { readonly [key: string]: string | undefined }

/**
 * A SQL commenter plugin that returns key-value pairs to be added as comments.
 * Return an empty object to add no comments. Keys with undefined values will be omitted.
 *
 * @example
 * ```ts
 * const myPlugin: SqlCommenterPlugin = (context) => {
 *   return {
 *     application: 'my-app',
 *     model: context.query.modelName ?? 'raw',
 *     // Conditional key - will be omitted if ctx.sql is undefined
 *     sqlLength: context.sql ? String(context.sql.length) : undefined,
 *   }
 * }
 * ```
 */
export interface SqlCommenterPlugin {
  (context: SqlCommenterContext): SqlCommenterTags
}
