import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import type { ModelAccessor } from '@prisma/orm-postgres/orm-client';
import type { Char } from '@prisma/orm-postgres/target/codec-types';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import type { Contract } from '../prisma/contract';
import { createOrmClient } from './client';

export async function ormClientFindSimilarPosts(postId: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);

  const typedPostId = blindCast<
    Char<36>,
    'the query boundary accepts an unvalidated UUID string while the contract models it as Char<36>'
  >(postId);
  const toPost = await db.Post.select('embedding').first({ id: typedPostId });
  if (!toPost) {
    throw new Error(`Post not found: ${postId}`);
  }

  const { embedding } = toPost;
  if (!embedding) {
    return [];
  }

  const cosineDistanceFrom = (fromPost: ModelAccessor<Contract, 'Post'>) =>
    fromPost.embedding.cosineDistance(embedding);

  return db.Post.where((p) => p.id.neq(typedPostId))
    .where((p) => cosineDistanceFrom(p).lt(1))
    .orderBy((p) => cosineDistanceFrom(p).asc())
    .select('id', 'title', 'userId')
    .include('user', (user) => user.select('id', 'email'))
    .limit(limit)
    .all();
}
