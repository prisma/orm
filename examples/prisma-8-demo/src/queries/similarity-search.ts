import { db } from '../prisma/db';

/**
 * Search for posts by cosine distance to a query vector.
 * Returns the top N posts ordered by similarity (closest first).
 */
export async function similaritySearch(queryVector: number[], limit = 10) {
  const plan = db.sql.public.post
    .select('id', 'title')
    .select('distance', (f, fns) => fns.cosineDistance(f.embedding, queryVector))
    .orderBy((f, fns) => fns.cosineDistance(f.embedding, queryVector), { direction: 'asc' })
    .limit(limit)
    .build();
  return db.query(plan);
}
