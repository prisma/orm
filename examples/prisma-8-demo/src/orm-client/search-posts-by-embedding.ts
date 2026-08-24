import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientSearchPostsByEmbedding(
  searchEmbedding: number[],
  maxDistance: number,
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.Post.where((p) => p.embedding.cosineDistance(searchEmbedding).lt(maxDistance))
    .orderBy((p) => p.embedding.cosineDistance(searchEmbedding).asc())
    .limit(limit)
    .all();
}
