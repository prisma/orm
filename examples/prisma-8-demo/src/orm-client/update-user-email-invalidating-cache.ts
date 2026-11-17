/**
 * `User.update({ email })` that removes the user's cached lookup.
 *
 * Demonstrates the write-only `invalidateAnnotation`: the update carries the key that `ormClientFindUserByIdCached` stores the user under, and the cache middleware removes it once the update has committed. Inside a transaction it would wait for that transaction to commit.
 */

import { invalidateAnnotation } from '@prisma/orm-extension-middleware-cache';
import type { DemoOrm } from '../prisma/db';
import { toUserId, userCacheKey } from './find-user-by-id-cached';

export async function ormClientUpdateUserEmailInvalidatingCache(
  id: string,
  email: string,
  orm: DemoOrm,
) {
  return orm.User.where({ id: toUserId(id) })
    .select('id', 'email', 'kind')
    .update({ email }, (meta) => meta.annotate(invalidateAnnotation({ keys: [userCacheKey(id)] })));
}
