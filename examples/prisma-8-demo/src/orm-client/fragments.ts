import { field, type } from '@prisma/orm-postgres/contract-builder';
import type { CodecField } from '@prisma/orm-postgres/orm-client';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';

/**
 * A scope for any model with a `createdAt` timestamp, such as `User`, `Post` and `Task`: rows created since `since`.
 */
export function createdSince(since: Temporal.Instant) {
  return db.orm.fragment({ createdAt: field.column(type.TimestamptzTemporal()) }, (rows) =>
    rows.where((row) => row.createdAt.gte(since)),
  );
}

/**
 * A row fragment for any model with a `createdAt` timestamp, run with `where`: rows created before `before`.
 * `createdSince` is a query fragment, run with `with`; `createdBefore` is a row fragment, run with `where`.
 */
export function createdBefore(before: Temporal.Instant) {
  return (row: { createdAt: CodecField<Contract, 'pg/timestamptz-temporal@1'> }) =>
    row.createdAt.lt(before);
}

/**
 * A scope for any model with a `userId`, such as `Post` and `Task`: rows that belong to one user.
 */
export function ownedBy(userId: string) {
  return db.orm.fragment({ userId: field.column(type.Uuid()) }, (rows) =>
    rows.where((row) => row.userId.eq(userId)),
  );
}

/**
 * The fields of a post that a list of posts shows, run with `with` on any collection of posts.
 */
export const postSummary = db.orm.public.Post.fragment((posts) =>
  posts.select('id', 'title', 'createdAt').include('tags'),
);
