import { type CodecField, modelStep } from '@prisma/orm-postgres/orm-client';
import type { Contract } from '../prisma/contract.d';

type CreatedAt = CodecField<Contract, 'pg/timestamptz-temporal@1'>;

/**
 * A `where` callback for any model with a `createdAt` timestamp: `User`, `Post` and `Task`.
 */
export function createdSince(since: Temporal.Instant) {
  return (row: { createdAt: CreatedAt }) => row.createdAt.gte(since);
}

/**
 * The fields of a post that a list of posts shows, applied with `pipe` to any collection of posts.
 */
export const postSummary = modelStep<Contract, 'Post'>()((posts) =>
  posts.select('id', 'title', 'createdAt').include('tags'),
);
