import type { DemoOrm } from '../prisma/db';

/**
 * The posts nearest to `searchEmbedding` by cosine distance, within `maxDistance`. `using.embedding_nearest` is the method the pgvector package contributes for the `embedding` field.
 */
export async function ormClientSearchPostsByEmbedding(
  searchEmbedding: number[],
  maxDistance: number,
  limit: number,
  orm: DemoOrm,
) {
  return orm.Post.select('id', 'title', 'userId')
    .using.embedding_nearest(searchEmbedding, maxDistance)
    .limit(limit)
    .all();
}
