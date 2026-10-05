import { field } from '@prisma/orm-postgres/contract-builder';
import { db } from '../prisma/db';

/**
 * A scope for any model with a `createdAt` timestamp, such as `User`, `Post` and `Task`: rows created since `since`.
 */
export function createdSince(since: Temporal.Instant) {
  return db.orm.scope({ createdAt: field.temporal.timestamptz() }, (rows) =>
    rows.where((row) => row.createdAt.gte(since)),
  );
}

/**
 * A scope for any model with a `userId`, such as `Post` and `Task`: rows that belong to one user.
 */
export function ownedBy(userId: string) {
  return db.orm.scope({ userId: field.uuidNative() }, (rows) =>
    rows.where((row) => row.userId.eq(userId)),
  );
}

/**
 * The fields of a post that a list of posts shows, run with `apply` on any collection of posts.
 */
export const postSummary = db.orm.public.Post.scope((posts) =>
  posts.select('id', 'title', 'createdAt').include('tags'),
);
