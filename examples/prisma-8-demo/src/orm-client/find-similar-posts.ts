import type { ModelAccessor } from '@prisma/orm-postgres/orm-client';
import type { Char } from '@prisma/orm-postgres/target/codec-types';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import { NotFoundError } from '../errors';
import type { Contract } from '../prisma/contract';
import type { DemoOrm } from '../prisma/db';

export async function ormClientFindSimilarPosts(postId: string, limit: number, orm: DemoOrm) {
  const typedPostId = blindCast<
    Char<36>,
    'the query boundary accepts an unvalidated UUID string while the contract models it as Char<36>'
  >(postId);
  const toPost = await orm.Post.select('embedding').first({ id: typedPostId });
  if (!toPost) {
    throw new NotFoundError(`Post not found: ${postId}`);
  }

  const { embedding } = toPost;
  if (!embedding) {
    return [];
  }

  const cosineDistanceFrom = (fromPost: ModelAccessor<Contract, 'Post'>) =>
    fromPost.embedding.cosineDistance(embedding);

  return orm.Post.where((p) => p.id.neq(typedPostId))
    .where((p) => cosineDistanceFrom(p).lt(1))
    .orderBy((p) => cosineDistanceFrom(p).asc())
    .select('id', 'title', 'userId')
    .include('user', (user) => user.select('id', 'email'))
    .limit(limit)
    .all();
}
