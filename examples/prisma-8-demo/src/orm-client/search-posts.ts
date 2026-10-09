import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import { createOrmClient } from './client';

/**
 * Full-text search over a post's title and body, best match first.
 *
 * The query names the `post_search` index, so it searches the document the
 * index was built over: the title with weight A and the body with weight B. A
 * match in the title ranks above a match in the body, and Postgres uses the
 * index.
 */
export async function ormClientSearchPosts(query: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  const q = websearchToTsquery(query);
  return db.Post.select('id', 'title', 'body')
    .where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_search, q))
    .orderBy((_p, { fns, indexes }) => fns.fullTextRank(indexes.post_search, q).desc())
    .orderBy((p) => p.id.asc())
    .limit(limit)
    .all();
}
