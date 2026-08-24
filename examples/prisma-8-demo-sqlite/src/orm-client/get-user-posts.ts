import type { DefaultModelRow } from '@prisma/orm-sqlite/orm-client';
import type { SqliteRuntime } from '@prisma/orm-sqlite/runtime';
import { castAs } from '@prisma/orm-sqlite/utils/casts';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserId = DefaultModelRow<Contract, 'User'>['id'];

/**
 * Relational ORM example: fetch a user along with their posts in a single
 * call. Demonstrates `.include('posts', ...)` traversing the
 * `User → Post` hasMany relation declared in `prisma/contract.ts`.
 */
export async function ormClientGetUserPosts(userId: string, limit: number, runtime: SqliteRuntime) {
  const db = createOrmClient(runtime);
  return db.User.include('posts', (post) => post.orderBy((p) => p.createdAt.desc()).limit(limit))
    .where({ id: castAs<UserId>(userId) })
    .first();
}
