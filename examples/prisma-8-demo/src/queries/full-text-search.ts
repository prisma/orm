import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { db } from '../prisma/db';

/**
 * Full-text search over post titles through the SQL DSL, returning the
 * relevance score and a `<mark>`-highlighted snippet beside each hit.
 *
 * `fullTextMatches` and `fullTextRank` search the `post_title_search` index
 * the contract declares, read from the table's `indexes`, so the query
 * searches the document the index was built over. `fullTextHeadline`
 * highlights one column, and `websearchToTsquery` is reachable as a `fns`
 * member; the builder is the surface to reach for when the result needs a
 * computed column the ORM's `select()` cannot express.
 */
export async function fullTextSearch(query: string, limit: number, runtime: Runtime) {
  const post = db.sql.public.post;
  const titleSearch = post.indexes.post_title_search;
  const plan = post
    .select('id', 'title')
    .select('rank', (_f, fns) => fns.fullTextRank(titleSearch, fns.websearchToTsquery(query)))
    .select('headline', (f, fns) =>
      fns.fullTextHeadline(f.title, fns.websearchToTsquery(query), {
        startSel: '<mark>',
        stopSel: '</mark>',
      }),
    )
    .where((_f, fns) => fns.fullTextMatches(titleSearch, fns.websearchToTsquery(query)))
    .orderBy((_f, fns) => fns.fullTextRank(titleSearch, fns.websearchToTsquery(query)), {
      direction: 'desc',
    })
    .orderBy((f) => f.id, { direction: 'asc' })
    .limit(limit)
    .build();
  return runtime.query(plan);
}
