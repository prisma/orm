import type { DefaultModelRow } from '@prisma/orm-sqlite/orm-client';
import { castAs } from '@prisma/orm-sqlite/utils/casts';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';

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
export async function ormClientCreatePostConnectTags(input: CreatePostConnectTagsInput) {
  return db.orm.Post.create({
    id: castAs<PostRow['id']>(input.id),
    title: input.title,
    userId: castAs<PostRow['userId']>(input.userId),
    tags: (t) => t.connect(input.tagIds.map((id) => ({ id: castAs<TagId>(id) }))),
  });
}
