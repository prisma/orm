import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { db } from '../prisma/db';

/**
 * Full-text search over post titles through the SQL DSL, returning the
 * relevance score and a `<mark>`-highlighted snippet beside each hit.
 *
 * `fullTextRank` and `fullTextHeadline` are the SQL builder's twins of the
 * ORM column operations, and `websearchToTsquery` is reachable as a `fns`
 * member; the builder is the surface to reach for when the result needs a
 * computed column the ORM's `select()` cannot express.
 */
export async function fullTextSearch(query: string, limit: number, runtime: Runtime) {
  const plan = db.sql.public.post
    .select('id', 'title')
    .select('rank', (f, fns) => fns.fullTextRank(f.title, fns.websearchToTsquery(query)))
    .select('headline', (f, fns) =>
      fns.fullTextHeadline(f.title, fns.websearchToTsquery(query), {
        startSel: '<mark>',
        stopSel: '</mark>',
      }),
    )
    .where((f, fns) => fns.fullTextMatches(f.title, fns.websearchToTsquery(query)))
    .orderBy((f, fns) => fns.fullTextRank(f.title, fns.websearchToTsquery(query)), {
      direction: 'desc',
    })
    .orderBy((f) => f.id, { direction: 'asc' })
    .limit(limit)
    .build();
  return runtime.query(plan);
}
