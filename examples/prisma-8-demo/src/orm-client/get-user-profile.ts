import type { Shape } from '@prisma/orm-postgres/family-contract/types';
import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import type { Models } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserId = Models.public_User['id'];

/**
 * The API response contract for a user profile, declared from the model:
 * every scalar except `email`, plus each post's `id`, `title`, and `tags`.
 * The query inside `ormClientGetUserProfile` is an implementation detail;
 * the compiler checks its result against this type at the `return`.
 */
export type UserProfile = Shape<
  Models.public_User,
  { '-': 'email'; posts: { '+': 'id' | 'title' | 'tags' } }
>;

export async function ormClientGetUserProfile(
  userId: string,
  runtime: Runtime,
): Promise<UserProfile | null> {
  const db = createOrmClient(runtime);
  const user = await db.User.where({ id: toUserId(userId) })
    .include('posts', (posts) =>
      posts
        .orderBy((post) => post.createdAt.asc())
        .include('tags', (tags) => tags.orderBy((tag) => tag.label.asc())),
    )
    .first();
  if (user === null) return null;
  const { email: _email, ...rest } = user;
  return { ...rest, posts: user.posts.map(({ id, title, tags }) => ({ id, title, tags })) };
}

function toUserId(value: string): UserId {
  return blindCast<
    UserId,
    'demo CLI supplies ids as plain strings; the contract brands User.id as a Char<36> uuid'
  >(value);
}
