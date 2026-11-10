import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import type { Contract } from '../prisma/contract.d';
import type { DemoOrm } from '../prisma/db';

type PostRow = DefaultModelRow<Contract, 'Post'>;
type TagId = DefaultModelRow<Contract, 'Tag'>['id'];

export interface CreatePostConnectTagsInput {
  readonly id: string;
  readonly title: string;
  readonly userId: string;
  readonly tagIds: readonly string[];
}

/**
 * Many-to-many connect-in-create example: insert a new post and link it to
 * already-existing tags in the same nested mutation. Demonstrates
 * `t.connect([...])` on an N:M relation from inside a `create()` call —
 * the create-flow counterpart of the `connect-post-tags` update example.
 */
export async function ormClientCreatePostConnectTags(
  input: CreatePostConnectTagsInput,
  orm: DemoOrm,
) {
  return orm.Post.create({
    id: toPostId(input.id),
    title: input.title,
    userId: input.userId,
    tags: (t) => t.connect(input.tagIds.map((id) => ({ id: toTagId(id) }))),
  });
}

function toPostId(value: string): PostRow['id'] {
  return blindCast<
    PostRow['id'],
    'demo CLI supplies ids as plain strings; the contract brands Post.id as a Char<36> uuid'
  >(value);
}

function toTagId(value: string): TagId {
  return blindCast<
    TagId,
    'demo CLI supplies ids as plain strings; the contract brands Tag.id as a Char<36> uuid'
  >(value);
}
