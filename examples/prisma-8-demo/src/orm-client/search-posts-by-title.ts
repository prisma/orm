import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

/**
 * Full-text search over post titles, best match first.
 *
 * `fullTextMatches` lowers to `to_tsvector('english', title) @@
 * websearch_to_tsquery('english', $1)`, the expression the `@@fullTextIndex`
 * on `Post` indexes, so the search hits the GIN index. The query string is a
 * bound parameter, and it takes the search-box syntax `websearch_to_tsquery`
 * accepts: `"an exact phrase"`, `-excluded`, `or`.
 */
export async function ormClientSearchPostsByTitle(query: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Post.select('id', 'title', 'userId')
    .where((p) => p.title.fullTextMatches(query))
    .orderBy((p) => p.title.fullTextRank(query).desc())
    .orderBy((p) => p.id.asc())
    .limit(limit)
    .all();
}
