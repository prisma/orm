import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import type { Contract } from '../prisma/contract.d';
import type { DemoOrm } from '../prisma/db';

type PostRow = DefaultModelRow<Contract, 'Post'>;

export interface CreatePostWithTagsInput {
  readonly id: string;
  readonly title: string;
  readonly userId: string;
  readonly tags: ReadonlyArray<{ readonly label: string }>;
}

/**
 * Many-to-many nested create example: insert a new post and simultaneously
 * create + link new tags via the callback mutator. Demonstrates
 * `t.create([...])` on an N:M relation from inside a `create()` call.
 */
export async function ormClientCreatePostWithTags(input: CreatePostWithTagsInput, orm: DemoOrm) {
  return orm.Post.create({
    id: toPostId(input.id),
    title: input.title,
    userId: input.userId,
    tags: (t) => t.create(input.tags.map((tag) => ({ label: tag.label }))),
  });
}

function toPostId(value: string): PostRow['id'] {
  return blindCast<
    PostRow['id'],
    'demo CLI supplies ids as plain strings; the contract brands Post.id as a Char<36> uuid'
  >(value);
}
