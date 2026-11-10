import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { db } from '../prisma/db';

/**
 * "Cross-author similarity" — an SQL DSL escape-hatch query for a shape that the current ORM
 * collection surface cannot directly express.
 *
 * Finds the closest pairs of posts written by *different* authors, ordered by cosine distance
 * between their embeddings. For each pair, projects both posts' id/title/userId side-by-side
 * along with the distance between their embeddings.
 *
 * Why this is an escape-hatch shape:
 *   1. **Self-join on a non-relation predicate.** The ORM collection surface's join is
 *      relation-shaped — `include('posts', ...)` follows declared relations. Joining `Post` to
 *      itself on `p1.userId != p2.userId` is an arbitrary predicate join, not a relation, and
 *      cannot be expressed as a single collection query.
 *   2. **Extension op taking two column references.** `cosineDistance(f.p1.embedding,
 *      f.p2.embedding)` compares two columns from two aliases within one query. The ORM's
 *      extension-op integration (TML-2042) is `column.method(boundValue)` — method-on-receiver
 *      form where the other argument must be a materialized value. `ormClientFindSimilarPosts`
 *      works around this by running a separate query to load the reference embedding first.
 *      The collection surface has no "column vs column within a single query" form.
 *   3. **Flat peer-row projection.** A single collection query has a single root model and
 *      shapes its output row from that root plus its relations. Two sibling `Post` rows
 *      projected flat into one output row is not a shape the single-collection surface
 *      produces.
 *
 * Note: `@internal/sql-orm-client` is a repository layer (ADR 164) and can orchestrate
 * multiple plans for one logical operation, so a user could *simulate* this with client-side
 * stitching — at the cost of extra round-trips and losing single-statement ordering/limit
 * semantics. The point of the SQL DSL escape hatch is that this shape is a single SQL
 * statement making one pass over the data.
 *
 * Features exercised:
 *   1. Self-join via `.as()` aliasing of the same table (`post` aliased as `p1` and `p2`).
 *   2. INNER JOIN with a non-equality predicate (`ne(p1.userId, p2.userId)`).
 *   3. pgvector `cosineDistance` called with two column references from two aliases — in the
 *      SELECT projection and in the ORDER BY.
 *   4. Typed result row inferred from the SELECT projection, mixing columns from both aliases.
 */
export async function crossAuthorSimilarity(limit = 10, runtime?: Runtime) {
  const plan = db.sql.public.post
    .as('p1')
    .innerJoin(db.sql.public.post.as('p2'), (f, fns) => fns.ne(f.p1.userId, f.p2.userId))
    .select((f, fns) => ({
      postAId: f.p1.id,
      postATitle: f.p1.title,
      postAUserId: f.p1.userId,
      postBId: f.p2.id,
      postBTitle: f.p2.title,
      postBUserId: f.p2.userId,
      distance: fns.cosineDistance(f.p1.embedding, f.p2.embedding),
    }))
    .where((f, fns) => fns.and(fns.ne(f.p1.embedding, null), fns.ne(f.p2.embedding, null)))
    .orderBy((f, fns) => fns.cosineDistance(f.p1.embedding, f.p2.embedding), {
      direction: 'asc',
    })
    .orderBy((f) => f.p1.id, { direction: 'asc' })
    .orderBy((f) => f.p2.id, { direction: 'asc' })
    .limit(limit)
    .build();

  return (runtime ?? db).query(plan);
}
