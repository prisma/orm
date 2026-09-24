import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import { createOrmClient } from './client';

/**
 * Full-text search over post titles, best match first.
 *
 * `fullTextMatches` lowers to `to_tsvector('english', title) @@ $1`, the
 * expression the `@@fullTextIndex` on `Post` indexes, so the search hits the
 * GIN index. `websearchToTsquery` turns the search-box string into the query:
 * a bound parameter, parsed by `websearch_to_tsquery`, so `"an exact phrase"`,
 * `-excluded` and `or` work. For a typeahead prefix match, the `tsquery` tag
 * quotes the typed text as one term: `` tsquery`${term}:*` ``.
 */
export async function ormClientSearchPostsByTitle(query: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Post.select('id', 'title', 'userId')
    .where((p) => p.title.fullTextMatches(websearchToTsquery(query)))
    .orderBy((p) => p.title.fullTextRank(websearchToTsquery(query)).desc())
    .orderBy((p) => p.id.asc())
    .limit(limit)
    .all();
}
